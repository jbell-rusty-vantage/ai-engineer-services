import { z } from "zod";
import { ProductError } from "../errors.js";
import { isKnowledgeOperation } from "../knowledge.js";
import { type OperationDefinition, type OperationKind, type OperationScope, operationCatalog } from "../operations.js";
import { databaseValidatedPayload } from "../payloads.js";
import type { JsonObject } from "../port.js";
import { findSurfaceTool, type GuideTopic, surfaceJobs, surfaceTools } from "../surface.js";
import { operationNotes } from "./operation-notes.js";
import { topicForOperation } from "./operation-topics.js";

export interface OperationDescription {
  readonly operation: string;
  readonly kind: OperationKind;
  readonly scope: OperationScope;
  readonly topic: GuideTopic | null;
  readonly summary: string;
  readonly request: { readonly method: "POST"; readonly path: string; readonly body: string };
  /** JSON Schema of the payload; `null` when only the database layer validates it. */
  readonly input: unknown;
  /** The result shape; `null` when it is not declared here (read the schema page). */
  readonly output: string | null;
  readonly example: { readonly cli: string; readonly payload: JsonObject | null };
  /** MCP tools that call this operation. */
  readonly tools: readonly string[];
  /** Schema workspace pages to read with `schema_get`. */
  readonly schema_pages: readonly string[];
}

export interface ToolDescription {
  readonly tool: string;
  readonly title: string;
  readonly summary: string;
  /** Guide topics that explain it. */
  readonly topics: readonly GuideTopic[];
  /** Operations it calls; describe any of them for the exact shapes. */
  readonly operations: readonly string[];
}

const requestBodies: Readonly<Record<OperationKind, string>> = {
  command: "{ workspaceId, idempotencyKey, expectedHead?, payload }",
  read: "{ workspaceId?, payload }",
};

function payloadSchema(definition: OperationDefinition): unknown {
  if (definition.payload === databaseValidatedPayload) return null;
  const { $schema: _dialect, ...schema } = z.toJSONSchema(definition.payload, { io: "input", unrepresentable: "any" });
  return schema;
}

function cliExample(definition: OperationDefinition, payload: JsonObject | null): string {
  const workspace = isKnowledgeOperation(definition.name) ? "" : " --workspace <workspace-id>";
  return `aieng ${definition.kind} ${definition.name}${workspace} --payload '${payload ? JSON.stringify(payload) : "<json>"}'`;
}

function describeOperation(definition: OperationDefinition): OperationDescription {
  const note = operationNotes[definition.name];
  const payload = note?.example ?? null;
  return {
    operation: definition.name,
    kind: definition.kind,
    scope: definition.scope,
    topic: topicForOperation(definition.name) ?? null,
    summary: definition.summary,
    request: {
      method: "POST",
      path: `/v1/${definition.kind === "command" ? "commands" : "reads"}/${definition.name}`,
      body: requestBodies[definition.kind],
    },
    input: payloadSchema(definition),
    output: note?.output ?? null,
    example: { cli: cliExample(definition, payload), payload },
    tools: surfaceTools.filter((tool) => tool.operations.includes(definition.name)).map((tool) => tool.name),
    schema_pages: note?.pages ?? [`ops/${definition.name}.md`],
  };
}

function describeTool(name: string): ToolDescription | undefined {
  const tool = findSurfaceTool(name);
  if (!tool) return undefined;
  const topics = surfaceJobs.filter((job) => (job.tools as readonly string[]).includes(name)).map((job) => job.topic);
  return {
    tool: tool.name,
    title: tool.title,
    summary: tool.summary,
    topics: [...new Set(topics)],
    operations: tool.operations,
  };
}

/** Describes one public operation, or names the operations an MCP tool calls. */
export function describeReference(reference: string): OperationDescription | ToolDescription {
  const name = reference.trim();
  const definition = operationCatalog.get(name);
  if (definition?.exposure === "public") return describeOperation(definition);
  const tool = describeTool(name);
  if (tool) return tool;
  throw new ProductError("UNKNOWN_OPERATION", `${name || "(empty)"}; list operations with aieng operations`);
}
