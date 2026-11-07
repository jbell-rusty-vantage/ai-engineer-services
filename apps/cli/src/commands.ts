import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import {
  type AiEngineerClient,
  collectDirectoryFiles,
  mediaTypeForPath,
  publishSite,
} from "@aiengineer/service-client";
import { artifactTypes, assetUsages, type JsonObject, ProductError } from "@aiengineer/service-contracts";

export type Options = Readonly<Record<string, string | boolean | undefined>>;

export const usage = `aieng — AI Engineer command line

Environment: AIENG_API_URL, AIENG_ACCESS_TOKEN, optional AIENG_CLIENT_TOKEN.

  aieng operations
  aieng command <operation> [--workspace <id>] [--head <id>] [--key <idempotency-key>] [--payload <json|@file>]
  aieng read <operation> [--workspace <id>] [--payload <json|@file>]
  aieng upload <file> --workspace <id> --usage <usage> --rights <text> [--type <artifact-type>] [--media <type>]
  aieng site publish <directory> --workspace <id> [--entry index.html] [--environment preview|published]
  aieng search <query> [--limit <n>]`;

function stringOption(options: Options, name: string): string | undefined {
  const value = options[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function requiredOption(options: Options, name: string): string {
  const value = stringOption(options, name);
  if (!value) throw new ProductError("VALIDATION", `--${name} is required`);
  return value;
}

async function payloadFrom(options: Options): Promise<JsonObject> {
  const raw = stringOption(options, "payload");
  if (!raw) return {};
  const text = raw.startsWith("@") ? await readFile(raw.slice(1), "utf8") : raw;
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    throw new ProductError("VALIDATION", "--payload must be a JSON object");
  return parsed as JsonObject;
}

function oneOf<T extends string>(value: string, allowed: readonly T[], name: string): T {
  if (!(allowed as readonly string[]).includes(value))
    throw new ProductError("VALIDATION", `--${name} must be one of ${allowed.join(", ")}`);
  return value as T;
}

/** Runs one CLI command and returns the JSON value to print. */
export async function runCommand(
  client: AiEngineerClient,
  positionals: readonly string[],
  options: Options,
): Promise<unknown> {
  const [command, first, second] = positionals;
  switch (command) {
    case "operations":
      return client.operations();
    case "command":
      if (!first) throw new ProductError("VALIDATION", "operation name required");
      return client.command(first, {
        workspaceId: stringOption(options, "workspace") ?? null,
        expectedHead: stringOption(options, "head") ?? null,
        payload: await payloadFrom(options),
        ...(stringOption(options, "key") ? { idempotencyKey: requiredOption(options, "key") } : {}),
      });
    case "read":
      if (!first) throw new ProductError("VALIDATION", "operation name required");
      return client.read(first, {
        workspaceId: stringOption(options, "workspace") ?? null,
        payload: await payloadFrom(options),
      });
    case "upload": {
      if (!first) throw new ProductError("VALIDATION", "file path required");
      const bytes = new Uint8Array(await readFile(first));
      return client.uploadAsset(
        {
          workspaceId: requiredOption(options, "workspace"),
          artifactType: oneOf(stringOption(options, "type") ?? "authored_work_asset", artifactTypes, "type"),
          mediaType: stringOption(options, "media") ?? mediaTypeForPath(basename(first)),
          usage: oneOf(requiredOption(options, "usage"), assetUsages, "usage"),
          rightsBasis: requiredOption(options, "rights"),
        },
        bytes,
      );
    }
    case "site":
      if (first !== "publish" || !second)
        throw new ProductError("VALIDATION", "usage: aieng site publish <directory> --workspace <id>");
      return publishSite(client, {
        workspaceId: requiredOption(options, "workspace"),
        entrypoint: stringOption(options, "entry") ?? "index.html",
        files: await collectDirectoryFiles(second),
        environment: oneOf(
          stringOption(options, "environment") ?? "preview",
          ["preview", "published"] as const,
          "environment",
        ),
      });
    case "search":
      if (!first) throw new ProductError("VALIDATION", "query required");
      return client.read("search", {
        payload: { query: first, ...(stringOption(options, "limit") ? { limit: Number(options.limit) } : {}) },
      });
    default:
      throw new ProductError("VALIDATION", `unknown command${command ? ` ${command}` : ""}\n\n${usage}`);
  }
}
