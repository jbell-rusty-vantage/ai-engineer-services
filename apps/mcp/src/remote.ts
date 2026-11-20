import {
  createDatabaseReleaseCheck,
  createProductService,
  createSchemaWorkspace,
  DatabaseReleaseRefused,
  describeDatabaseTarget,
  loadServiceConfig,
} from "@aiengineer/service-application";
import { buildRemoteMcpHost } from "./remote-host.js";

const host = process.env.AIENG_MCP_HOST ?? "127.0.0.1";
const port = Number(process.env.AIENG_MCP_PORT ?? 3201);

const config = loadServiceConfig();
const app = buildRemoteMcpHost({
  service: createProductService(config),
  schema: createSchemaWorkspace(),
  databaseRelease: createDatabaseReleaseCheck(config),
});

const shutdown = () => void app.close();
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

try {
  await app.listen({ host, port });
  process.stdout.write(
    `${JSON.stringify({ event: "aieng.mcp.listening", host, port, database: describeDatabaseTarget(config) })}\n`,
  );
} catch (error) {
  // A refused database release is the one failure that explains itself: its release, this service's range, the fix.
  const refusal = error instanceof DatabaseReleaseRefused ? { code: error.code, message: error.message } : {};
  process.stderr.write(`${JSON.stringify({ event: "aieng.mcp.start_failed", ...refusal })}\n`);
  process.exitCode = 1;
}
