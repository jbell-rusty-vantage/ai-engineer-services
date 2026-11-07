import { ProductError } from "@aiengineer/service-contracts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ZodError } from "zod";
import { startAttempt, submitAttempt } from "./tools/attempt-tools.js";
import { draftWork, publishBuiltSite } from "./tools/authoring-tools.js";
import { annotateLessonBlock, checkProgress, readLesson, searchLearning } from "./tools/learning-tools.js";
import {
  citeEvidence,
  deliverOutput,
  inspectResearch,
  proposeResearch,
  updateDataset,
} from "./tools/research-tools.js";
import type { McpTool, ToolContext } from "./tools/tool-definition.js";

/** The curated, task-shaped tool set. Every tool calls product operations through the `ProductPort`. */
export const aiEngineerTools: readonly McpTool[] = [
  searchLearning,
  readLesson,
  annotateLessonBlock,
  checkProgress,
  draftWork,
  publishBuiltSite,
  startAttempt,
  submitAttempt,
  proposeResearch,
  inspectResearch,
  updateDataset,
  citeEvidence,
  deliverOutput,
];

function textResult(value: unknown, isError = false): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], ...(isError ? { isError: true } : {}) };
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
