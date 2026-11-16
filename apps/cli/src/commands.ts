import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import {
  type AiEngineerClient,
  collectDirectoryFiles,
  mediaTypeForPath,
  publishSite,
} from "@aiengineer/service-client";
import {
  artifactTypes,
  assetUsages,
  commandUsage,
  describeReference,
  formatSchemaPage,
  type JsonObject,
  ProductError,
  renderGuide,
  surfaceCommands,
} from "@aiengineer/service-contracts";
import { runKnowledgeCommand } from "./knowledge-commands.js";
import { argument, numberOption, type Options, oneOf, requiredOption, stringOption } from "./options.js";

export type { Options } from "./options.js";

/** The usage text, generated from the surface catalog the guide and the MCP server also read. */
export const usage = `aieng — AI Engineer command line

Environment: AIENG_API_URL, AIENG_ACCESS_TOKEN, optional AIENG_CLIENT_TOKEN. Start with: aieng guide

${surfaceCommands.map((command) => `  ${commandUsage(command)}`).join("\n")}`;

/** Commands answered from the built-in catalog: they need no API and no credentials. */
const referenceCommands = new Set(["guide", "describe"]);

export function isReferenceCommand(command: string | undefined): boolean {
  return command !== undefined && referenceCommands.has(command);
}

/** `aieng guide [topic]` prints the guide text; `aieng describe <operation>` one operation's shapes. */
export function runReferenceCommand(positionals: readonly string[]): unknown {
  const [command, first] = positionals;
  return command === "guide" ? renderGuide(first).text : describeReference(argument(first, "operation name"));
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

async function runSchemaCommand(
  client: AiEngineerClient,
  verb: string | undefined,
  subject: string | undefined,
  options: Options,
): Promise<unknown> {
  if (verb === "search") {
    const limit = numberOption(options, "limit");
    const kind = stringOption(options, "kind");
    return client.searchSchema(argument(subject, "query"), { ...(limit ? { limit } : {}), ...(kind ? { kind } : {}) });
  }
  if (verb === "get") return formatSchemaPage(await client.getSchemaPage(subject));
  throw new ProductError("VALIDATION", "usage: aieng schema search <query> | aieng schema get [page]");
}

/** Runs one CLI command and returns the value to print: text as it is, anything else as JSON. */
export async function runCommand(
  client: AiEngineerClient,
  positionals: readonly string[],
  options: Options,
): Promise<unknown> {
  const [command, first, second] = positionals;
  switch (command) {
    case "guide":
    case "describe":
      return runReferenceCommand(positionals);
    case "operations":
      return client.operations();
    case "knowledge":
      return runKnowledgeCommand(client, first, second, options);
    case "schema":
      return runSchemaCommand(client, first, second, options);
    case "command":
      return client.command(argument(first, "operation name"), {
        workspaceId: stringOption(options, "workspace") ?? null,
        expectedHead: stringOption(options, "head") ?? null,
        payload: await payloadFrom(options),
        ...(stringOption(options, "key") ? { idempotencyKey: requiredOption(options, "key") } : {}),
      });
    case "read":
      return client.read(argument(first, "operation name"), {
        workspaceId: stringOption(options, "workspace") ?? null,
        payload: await payloadFrom(options),
      });
    case "upload": {
      const file = argument(first, "file path");
      const bytes = new Uint8Array(await readFile(file));
      return client.uploadAsset(
        {
          workspaceId: requiredOption(options, "workspace"),
          artifactType: oneOf(stringOption(options, "type") ?? "authored_work_asset", artifactTypes, "type"),
          mediaType: stringOption(options, "media") ?? mediaTypeForPath(basename(file)),
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
    case "search": {
      const limit = numberOption(options, "limit");
      return client.read("search", { payload: { query: argument(first, "query"), ...(limit ? { limit } : {}) } });
    }
    default:
      throw new ProductError("VALIDATION", `unknown command${command ? ` ${command}` : ""}\n\n${usage}`);
  }
}
