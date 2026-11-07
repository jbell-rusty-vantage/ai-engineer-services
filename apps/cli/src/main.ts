#!/usr/bin/env node
import { parseArgs } from "node:util";
import { AiEngineerClient } from "@aiengineer/service-client";
import { ProductError } from "@aiengineer/service-contracts";
import { runCommand, usage } from "./commands.js";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    workspace: { type: "string" },
    head: { type: "string" },
    key: { type: "string" },
    payload: { type: "string" },
    usage: { type: "string" },
    rights: { type: "string" },
    type: { type: "string" },
    media: { type: "string" },
    entry: { type: "string" },
    environment: { type: "string" },
    limit: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help || positionals.length === 0) {
  process.stdout.write(`${usage}\n`);
} else {
  const baseUrl = process.env.AIENG_API_URL?.trim();
  const accessToken = process.env.AIENG_ACCESS_TOKEN?.trim();
  const clientToken = process.env.AIENG_CLIENT_TOKEN?.trim();
  try {
    if (!baseUrl || !accessToken) throw new ProductError("AUTH_REQUIRED", "set AIENG_API_URL and AIENG_ACCESS_TOKEN");
    const client = new AiEngineerClient({ baseUrl, accessToken, ...(clientToken ? { clientToken } : {}) });
    const result = await runCommand(client, positionals, values);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const body = error instanceof ProductError ? error.toBody() : new ProductError("INTERNAL_ERROR").toBody();
    process.stderr.write(`${JSON.stringify(body)}\n`);
    process.exitCode = 1;
  }
}
