#!/usr/bin/env node
import { parseArgs } from "node:util";
import { AiEngineerClient } from "@aiengineer/service-client";
import { ProductError } from "@aiengineer/service-contracts";
import { isReferenceCommand, runCommand, runReferenceCommand, usage } from "./commands.js";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  allowNegative: true,
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
    lens: { type: "string" },
    tier: { type: "string" },
    space: { type: "string" },
    kind: { type: "string" },
    "as-of": { type: "string" },
    since: { type: "string" },
    release: { type: "string" },
    library: { type: "string" },
    name: { type: "string" },
    collapse: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});

/** Text (the guide, a schema page) is printed as it is; everything else as JSON. */
function print(result: unknown): void {
  process.stdout.write(`${typeof result === "string" ? result : JSON.stringify(result, null, 2)}\n`);
}

async function run(): Promise<unknown> {
  if (isReferenceCommand(positionals[0])) return runReferenceCommand(positionals);
  const baseUrl = process.env.AIENG_API_URL?.trim();
  const accessToken = process.env.AIENG_ACCESS_TOKEN?.trim();
  const clientToken = process.env.AIENG_CLIENT_TOKEN?.trim();
  if (!baseUrl || !accessToken) throw new ProductError("AUTH_REQUIRED", "set AIENG_API_URL and AIENG_ACCESS_TOKEN");
  const client = new AiEngineerClient({ baseUrl, accessToken, ...(clientToken ? { clientToken } : {}) });
  return runCommand(client, positionals, values);
}

if (values.help || positionals.length === 0) {
  print(usage);
} else {
  try {
    print(await run());
  } catch (error) {
    const body = error instanceof ProductError ? error.toBody() : new ProductError("INTERNAL_ERROR").toBody();
    process.stderr.write(`${JSON.stringify(body)}\n`);
    process.exitCode = 1;
  }
}
