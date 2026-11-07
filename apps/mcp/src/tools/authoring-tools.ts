import { randomUUID } from "node:crypto";
import { collectDirectoryFiles, publishSite, type SiteFile } from "@aiengineer/service-client";
import { type JsonObject, ProductError, workKinds } from "@aiengineer/service-contracts";
import { z } from "zod";
import { defineTool, type ToolContext } from "./tool-definition.js";

const id = z.guid();

interface WorkSummary {
  readonly id: string;
  readonly head: string;
}

async function currentHead(context: ToolContext, workspaceId: string, workId: string): Promise<string> {
  const works = (await context.port.read("list_works", { workspaceId, payload: {} })) as WorkSummary[];
  const work = works.find((candidate) => candidate.id === workId);
  if (!work) throw new ProductError("NOT_FOUND", "work");
  return work.head;
}

/** Keeps a markdown-only draft's block key stable across revisions so annotations keep pointing at it. */
async function textBlockKey(context: ToolContext, headRevisionId: string | undefined): Promise<string> {
  if (!headRevisionId) return randomUUID();
  const revision = (await context.port.read("get_revision", { payload: { revision_id: headRevisionId } })) as {
    body?: { blocks?: JsonObject[] };
  };
  const first = revision.body?.blocks?.[0];
  return first?.type === "text" && typeof first.key === "string" ? first.key : randomUUID();
}

export const draftWork = defineTool({
  name: "draft_work",
  title: "Draft or revise a work",
  description:
    "Create a work (lesson, note, challenge, project, ...) or save a new revision of an existing one. Give `markdown` for a " +
    "single text block, or `blocks` (aieng.work-body.v2) plus `bindings` for rich content. Revisions are immutable; a stale " +
    "expected_head is a conflict.",
  input: z
    .object({
      workspace_id: id,
      work_id: id.optional().describe("Revise this work instead of creating a new one"),
      expected_head: id.optional().describe("Defaults to the work's current head"),
      kind: z.enum(workKinds).optional().describe("Required when creating"),
      slug: z
        .string()
        .regex(/^[a-z0-9][a-z0-9-]{0,99}$/)
        .optional(),
      title: z.string().min(1),
      markdown: z.string().optional(),
      blocks: z.array(z.record(z.string(), z.unknown())).optional(),
      bindings: z.array(z.record(z.string(), z.unknown())).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    })
    .refine((input) => Boolean(input.markdown) !== Boolean(input.blocks), "give exactly one of markdown or blocks")
    .refine((input) => Boolean(input.work_id) || Boolean(input.kind), "kind is required when creating a work"),
  run: async (context, input) => {
    const head = input.work_id
      ? (input.expected_head ?? (await currentHead(context, input.workspace_id, input.work_id)))
      : undefined;
    const blocks = input.blocks ?? [
      { key: await textBlockKey(context, head), type: "text", content: { markdown: input.markdown } },
    ];
    const revision = {
      title: input.title,
      body: { formatVersion: 2, blocks, ...(input.metadata ? { metadata: input.metadata } : {}) },
      ...(input.bindings ? { bindings: input.bindings } : {}),
    };
    if (input.work_id) {
      return context.port.command("revise_work", {
        workspaceId: input.workspace_id,
        expectedHead: head ?? null,
        payload: { work_id: input.work_id, revision },
      });
    }
    return context.port.command("create_work", {
      workspaceId: input.workspace_id,
      payload: { kind: input.kind, slug: input.slug ?? `${input.kind}-${randomUUID().slice(0, 8)}`, revision },
    });
  },
});

export const publishBuiltSite = defineTool({
  name: "publish_built_site",
  title: "Publish a built site",
  description:
    "Publish a site built in the harness (pages, scripts, styles, images) into a workspace: every file is uploaded and verified, " +
    "registered as one file set, and given an isolated-origin preview deployment. Locally pass `directory`; remotely pass `files` " +
    "with base64 content. Embed the result in a lesson with an embedded_site block bound to the file set (role build).",
  input: z
    .object({
      workspace_id: id,
      entrypoint: z.string().default("index.html"),
      directory: z.string().optional().describe("Local folder (local MCP server only)"),
      files: z.array(z.object({ path: z.string().min(1), content_base64: z.string() })).optional(),
      environment: z.enum(["preview", "published"]).default("preview"),
    })
    .refine((input) => Boolean(input.directory) !== Boolean(input.files), "give exactly one of directory or files"),
  run: async (context, input) => {
    let files: SiteFile[];
    if (input.directory) {
      if (!context.localFiles)
        throw new ProductError("FORBIDDEN", "this server cannot read local folders; pass files instead");
      files = await collectDirectoryFiles(input.directory);
    } else {
      files = (input.files ?? []).map((file) => ({
        path: file.path,
        bytes: new Uint8Array(Buffer.from(file.content_base64, "base64")),
      }));
    }
    return publishSite(context.port, {
      workspaceId: input.workspace_id,
      entrypoint: input.entrypoint,
      files,
      environment: input.environment,
    });
  },
});
