import {
  type DatabaseReleaseCheck,
  type DatabaseReleaseStatus,
  databaseReleaseStatus,
  type ProductService,
  SessionProductPort,
} from "@aiengineer/service-application";
import { headerNames, type SchemaPort } from "@aiengineer/service-contracts";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import Fastify, { type FastifyInstance } from "fastify";
import { createAiEngineerMcpServer } from "./server.js";

export interface RemoteMcpHostOptions {
  readonly service: ProductService;
  /** Schema navigation, read in process from the generated schema workspace. */
  readonly schema?: SchemaPort;
  /**
   * The database release check (`createDatabaseReleaseCheck`). It runs once when the host starts, before any request
   * is served; a rejection (enforce mode on a release outside the service's range) stops the start.
   */
  readonly databaseRelease: DatabaseReleaseCheck;
}

/**
 * Stateless remote MCP host for agents without a sandbox. Each request is authenticated with the caller's bearer token
 * and served in process by the application layer; local folders are never readable.
 */
export function buildRemoteMcpHost(options: RemoteMcpHostOptions): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 32 * 1024 * 1024 });
  // The database is asked for its release once, when the host starts; a refused release never listens.
  let databaseRelease: DatabaseReleaseStatus | undefined;
  app.addHook("onReady", async () => {
    databaseRelease = databaseReleaseStatus(await options.databaseRelease());
  });
  app.get("/health", async () => ({ status: "ok", databaseRelease }));
  app.all("/mcp", async (request, reply) => {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer "))
      return reply.status(401).send({ code: "AUTH_REQUIRED", message: "AUTH_REQUIRED" });
    const clientToken = request.headers[headerNames.clientToken];
    const port = new SessionProductPort(options.service, {
      accessToken: authorization.slice("Bearer ".length),
      ...(typeof clientToken === "string" && clientToken ? { clientToken } : {}),
    });
    const server = createAiEngineerMcpServer({ port, schema: options.schema, localFiles: false });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.hijack();
    reply.raw.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(request.raw, reply.raw, request.body);
  });
  return app;
}
