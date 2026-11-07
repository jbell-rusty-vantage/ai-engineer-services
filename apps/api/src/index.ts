import { createProductService, describeDatabaseTarget, loadServiceConfig } from "@aiengineer/service-application";
import { buildApiServer } from "./server.js";

const host = process.env.AIENG_API_HOST ?? "127.0.0.1";
const port = Number(process.env.AIENG_API_PORT ?? 3200);

const config = loadServiceConfig();
const app = buildApiServer({ service: createProductService(config) });

const shutdown = () => void app.close();
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

try {
  await app.listen({ host, port });
  process.stdout.write(
    `${JSON.stringify({ event: "aieng.api.listening", host, port, database: describeDatabaseTarget(config) })}\n`,
  );
} catch {
  process.stderr.write(`${JSON.stringify({ event: "aieng.api.start_failed" })}\n`);
  process.exitCode = 1;
}
