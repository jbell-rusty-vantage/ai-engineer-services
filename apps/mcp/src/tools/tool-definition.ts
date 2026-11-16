import { findSurfaceTool, type ProductPort, type SchemaPort } from "@aiengineer/service-contracts";
import type { z } from "zod";

export interface ToolContext {
  readonly port: ProductPort;
  /** Schema navigation; absent when the host has no schema workspace. */
  readonly schema?: SchemaPort;
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

/**
 * Declares a tool whose `run` receives input already parsed by its own schema. The title and the one-line description
 * come from the surface catalog, which the guide and the CLI also read; depth belongs in the guide.
 */
export function defineTool<Input extends z.ZodObject>(tool: {
  readonly name: string;
  readonly input: Input;
  run(context: ToolContext, input: z.infer<Input>): Promise<unknown>;
}): McpTool {
  const surface = findSurfaceTool(tool.name);
  if (!surface) throw new Error(`TOOL_NOT_IN_SURFACE_CATALOG: ${tool.name}`);
  return {
    name: tool.name,
    title: surface.title,
    description: surface.summary,
    input: tool.input,
    run: async (context, input) => tool.run(context, tool.input.parse(input)),
  };
}

/** The caller's personal workspace (created on first use); learner-owned records live there. */
export async function personalWorkspaceId(context: ToolContext): Promise<string> {
  const result = await context.port.command("ensure_personal_workspace", { workspaceId: null, payload: {} });
  return String(result.workspaceId);
}
