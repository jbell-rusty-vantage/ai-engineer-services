import type { ProductPort } from "@aiengineer/service-contracts";
import type { z } from "zod";

export interface ToolContext {
  readonly port: ProductPort;
  /** True only for the local stdio server running beside the harness; the remote server never reads local files. */
  readonly localFiles: boolean;
}

export interface McpTool {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly input: z.ZodObject;
  run(context: ToolContext, input: unknown): Promise<unknown>;
}

/** Declares a tool whose `run` receives input already parsed by its own schema. */
export function defineTool<Input extends z.ZodObject>(tool: {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly input: Input;
  run(context: ToolContext, input: z.infer<Input>): Promise<unknown>;
}): McpTool {
  return { ...tool, run: (context, input) => tool.run(context, tool.input.parse(input)) };
}

/** The caller's personal workspace (created on first use); learner-owned records live there. */
export async function personalWorkspaceId(context: ToolContext): Promise<string> {
  const result = await context.port.command("ensure_personal_workspace", { workspaceId: null, payload: {} });
  return String(result.workspaceId);
}
