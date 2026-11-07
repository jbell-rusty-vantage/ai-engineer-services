import { type ProductService, SessionProductPort } from "@aiengineer/service-application";
import { headerNames } from "@aiengineer/service-contracts";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import Fastify, { type FastifyInstance } from "fastify";
import { createAiEngineerMcpServer } from "./server.js";

export interface RemoteMcpHostOptions {
  readonly service: ProductService;
}

/**
 * Stateless remote MCP host for agents without a sandbox. Each request is authenticated with the caller's bearer token
 * and served in process by the application layer; local folders are never readable.
 */
export function buildRemoteMcpHost(options: RemoteMcpHostOptions): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 32 * 1024 * 1024 });
  app.get("/health", async () => ({ status: "ok" }));
  app.all("/mcp", async (request, reply) => {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer "))
      return reply.status(401).send({ code: "AUTH_REQUIRED", message: "AUTH_REQUIRED" });
    const clientToken = request.headers[headerNames.clientToken];
    const port = new SessionProductPort(options.service, {
      accessToken: authorization.slice("Bearer ".length),
      ...(typeof clientToken === "string" && clientToken ? { clientToken } : {}),
    });
    const server = createAiEngineerMcpServer({ port, localFiles: false });
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
