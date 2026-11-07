import { createProductService, describeDatabaseTarget, loadServiceConfig } from "@aiengineer/service-application";
import { buildRemoteMcpHost } from "./remote-host.js";

const host = process.env.AIENG_MCP_HOST ?? "127.0.0.1";
const port = Number(process.env.AIENG_MCP_PORT ?? 3201);

const config = loadServiceConfig();
const app = buildRemoteMcpHost({ service: createProductService(config) });

const shutdown = () => void app.close();
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

try {
  await app.listen({ host, port });
  process.stdout.write(
    `${JSON.stringify({ event: "aieng.mcp.listening", host, port, database: describeDatabaseTarget(config) })}\n`,
  );
} catch {
  process.stderr.write(`${JSON.stringify({ event: "aieng.mcp.start_failed" })}\n`);
  process.exitCode = 1;
}
