import { ProductError, surfaceTools } from "@aiengineer/service-contracts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ZodError } from "zod";
import { startAttempt, submitAttempt } from "./tools/attempt-tools.js";
import { draftWork, inspectAuthoring, publishBuiltSite, requestReview } from "./tools/authoring-tools.js";
import { aiengDescribe, aiengGuide } from "./tools/guide-tools.js";
import { inspectKnowledge, searchKnowledge } from "./tools/knowledge-tools.js";
import { annotateLessonBlock, checkProgress, readLesson, searchLearning } from "./tools/learning-tools.js";
import {
  citeEvidence,
  deliverOutput,
  inspectResearch,
  proposeResearch,
  updateDataset,
} from "./tools/research-tools.js";
import { schemaGet, schemaSearch } from "./tools/schema-tools.js";
import type { McpTool, ToolContext } from "./tools/tool-definition.js";

const implementations: readonly McpTool[] = [
  aiengGuide,
  aiengDescribe,
  searchKnowledge,
  inspectKnowledge,
  schemaSearch,
  schemaGet,
  searchLearning,
  readLesson,
  annotateLessonBlock,
  checkProgress,
  draftWork,
  inspectAuthoring,
  requestReview,
  publishBuiltSite,
  startAttempt,
  submitAttempt,
  proposeResearch,
  inspectResearch,
  updateDataset,
  citeEvidence,
  deliverOutput,
];

/**
 * The curated, task-shaped tool set, in the order of the surface catalog. Every catalogued tool must be implemented
 * here, so the guide (which lists the catalog) never names a tool the server does not have.
 */
export const aiEngineerTools: readonly McpTool[] = surfaceTools.map((surface) => {
  const tool = implementations.find((candidate) => candidate.name === surface.name);
  if (!tool) throw new Error(`TOOL_NOT_IMPLEMENTED: ${surface.name}`);
  return tool;
});

/** Text answers (the guide, a schema page) are returned as they are; everything else as compact JSON. */
function textResult(value: unknown, isError = false): CallToolResult {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}

function errorResult(error: unknown): CallToolResult {
  if (error instanceof ProductError) return textResult(error.toBody(), true);
  if (error instanceof ZodError)
    return textResult(new ProductError("VALIDATION", error.issues[0]?.message).toBody(), true);
  return textResult(new ProductError("INTERNAL_ERROR").toBody(), true);
}

export function createAiEngineerMcpServer(context: ToolContext): McpServer {
  const server = new McpServer({ name: "ai-engineer", version: "0.1.0" });
  for (const tool of aiEngineerTools) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.input.shape },
      async (input: unknown) => {
        try {
          return textResult(await tool.run(context, input));
        } catch (error) {
          return errorResult(error);
        }
      },
    );
  }
  return server;
}
