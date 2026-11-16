import type { CallerSession, ProductService } from "@aiengineer/service-application";
import {
  assetUploadMetadata,
  commandRequest,
  describeReference,
  headerNames,
  httpStatusForError,
  maxAssetBytes,
  ProductError,
  publicOperations,
  readRequest,
  renderGuide,
  type SchemaPort,
} from "@aiengineer/service-contracts";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

export interface ApiServerOptions {
  readonly service: ProductService;
  /** Schema navigation over the generated schema workspace; without it the schema routes answer `NOT_AVAILABLE`. */
  readonly schema?: SchemaPort;
}

function callerSession(request: FastifyRequest): CallerSession {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) throw new ProductError("AUTH_REQUIRED");
  const clientToken = request.headers[headerNames.clientToken];
  return {
    accessToken: authorization.slice("Bearer ".length),
    ...(typeof clientToken === "string" && clientToken ? { clientToken } : {}),
  };
}

function parseOrFail<T>(
  schema: {
    safeParse(
      value: unknown,
    ): { success: true; data: T } | { success: false; error: { issues: { message: string; path: PropertyKey[] }[] } };
  },
  value: unknown,
): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  throw new ProductError(
    "VALIDATION",
    issue ? `${issue.path.join(".") || "body"}: ${issue.message}` : "invalid request",
  );
}

function assetMetadataFrom(request: FastifyRequest): unknown {
  const header = request.headers[headerNames.assetMetadata];
  if (typeof header !== "string")
    throw new ProductError("VALIDATION", `${headerNames.assetMetadata} header is required`);
  try {
    return JSON.parse(header);
  } catch {
    throw new ProductError("VALIDATION", `${headerNames.assetMetadata} must be JSON`);
  }
}

function schemaPort(options: ApiServerOptions): SchemaPort {
  if (!options.schema) throw new ProductError("NOT_AVAILABLE", "schema navigation is not configured on this server");
  return options.schema;
}

/** The AI Engineer product API: one HTTP surface over the shared application layer. */
export function buildApiServer(options: ApiServerOptions): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });

  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer", bodyLimit: maxAssetBytes },
    (_request, body, done) => done(null, body),
  );

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ProductError) return reply.status(httpStatusForError(error.code)).send(error.toBody());
    const status =
      typeof (error as { statusCode?: unknown }).statusCode === "number"
        ? (error as { statusCode: number }).statusCode
        : 500;
    if (status === 413) return reply.status(413).send(new ProductError("LIMIT_EXCEEDED", "request too large").toBody());
    if (status >= 400 && status < 500)
      return reply.status(422).send(new ProductError("VALIDATION", "malformed request").toBody());
    return reply.status(500).send(new ProductError("INTERNAL_ERROR").toBody());
  });

  app.get("/health", async () => ({ status: "ok" }));

  // Reference routes: the guide, the catalog and schema navigation. They read no user data and need no session.
  app.get("/v1/guide", async () => renderGuide());

  // A topic may hold slashes: a skill's reference is `<skill>/references/<name>`.
  app.get<{ Params: { "*": string } }>("/v1/guide/*", async (request) => renderGuide(request.params["*"]));

  app.get("/v1/operations", async () => ({
    operations: publicOperations().map(({ name, kind, scope, summary }) => ({ name, kind, scope, summary })),
  }));

  app.get<{ Params: { operation: string } }>("/v1/operations/:operation", async (request) =>
    describeReference(request.params.operation),
  );

  app.get<{ Querystring: { query?: string; limit?: string; kind?: string } }>("/v1/schema/search", async (request) => {
    const { query, limit, kind } = request.query;
    if (!query?.trim()) throw new ProductError("VALIDATION", "query is required");
    if (limit !== undefined && !/^[0-9]+$/.test(limit)) throw new ProductError("VALIDATION", "limit must be a number");
    return schemaPort(options).searchSchema(query, {
      ...(limit ? { limit: Number(limit) } : {}),
      ...(kind ? { kind } : {}),
    });
  });

  app.get("/v1/schema/pages", async () => schemaPort(options).getSchemaPage());

  app.get<{ Params: { "*": string } }>("/v1/schema/pages/*", async (request) =>
    schemaPort(options).getSchemaPage(request.params["*"]),
  );

  app.post<{ Params: { operation: string } }>("/v1/commands/:operation", async (request) => {
    const session = callerSession(request);
    const body = parseOrFail(commandRequest, request.body);
    return options.service.runCommand(session, request.params.operation, {
      workspaceId: body.workspaceId,
      payload: body.payload,
      expectedHead: body.expectedHead ?? null,
      idempotencyKey: body.idempotencyKey,
    });
  });

  app.post<{ Params: { operation: string } }>("/v1/reads/:operation", async (request) => {
    const session = callerSession(request);
    const body = parseOrFail(readRequest, request.body);
    return options.service.runRead(session, request.params.operation, {
      workspaceId: body.workspaceId ?? null,
      payload: body.payload,
    });
  });

  app.post("/v1/assets", async (request, reply) => {
    const session = callerSession(request);
    const metadata = parseOrFail(assetUploadMetadata, assetMetadataFrom(request));
    if (!Buffer.isBuffer(request.body))
      throw new ProductError("VALIDATION", "upload body must be application/octet-stream");
    const result = await options.service.uploadAsset(session, metadata, new Uint8Array(request.body));
    return reply.status(201).send(result);
  });

  return app;
}
