import { randomUUID } from "node:crypto";
import { collectDirectoryFiles, publishSite, type SiteFile } from "@aiengineer/service-client";
import { type JsonObject, ProductError, workKinds } from "@aiengineer/service-contracts";
import { z } from "zod";
import { defineTool, personalWorkspaceId, type ToolContext } from "./tool-definition.js";

const id = z.guid();
const records = z.array(z.record(z.string(), z.unknown()));
const ceilings = ["workspace", "named", "public"] as const;

interface WorkSummary {
  readonly id: string;
  readonly kind: string;
  readonly slug: string;
  readonly head: string;
}

async function listWorks(context: ToolContext, workspaceId: string): Promise<WorkSummary[]> {
  return (await context.port.read("list_works", { workspaceId, payload: {} })) as WorkSummary[];
}

async function workIn(context: ToolContext, workspaceId: string, workId: string): Promise<WorkSummary> {
  const work = (await listWorks(context, workspaceId)).find((candidate) => candidate.id === workId);
  if (!work) throw new ProductError("NOT_FOUND", "work");
  return work;
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

/**
 * Research brief metadata (`aieng.research-brief.v1`), as the database checks it when the brief is proposed. Fields
 * stay optional here so a brief can be drafted in steps; `propose_research` reports what is still missing.
 */
const researchBrief = z.looseObject({
  schema: z.literal("aieng.research-brief.v1"),
  question: z.string().optional(),
  plan: z.array(z.unknown()).optional().describe("At least one step"),
  budget_limit_usd: z.number().min(0).optional(),
  knowledge_policy: z.enum(["sealed", "latest_at_run"]).optional(),
  obligations: z
    .array(
      z.looseObject({
        key: z.string(),
        form: z.enum(["dataset", "report", "experience", "finding_set", "file", "course_content"]),
        enforcement: z.enum(["required", "expected", "optional"]).optional(),
        expected_work_kind: z.string().optional(),
      }),
    )
    .optional()
    .describe("The outputs the research owes"),
  world: z.looseObject({ precision: z.enum(["day", "instant"]), from: z.string(), to: z.string() }).optional(),
});

/**
 * One tool for a work and its structure. It was extended rather than given a sibling: creating or revising a work is
 * one job over the same two operations, and every structure field is an optional part of the same revision. The
 * service checks the exact shapes (`aieng_describe create_work`); the tool only names them.
 */
export const draftWork = defineTool({
  name: "draft_work",
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
      markdown: z.string().optional().describe("One text block; give this or blocks"),
      blocks: records.optional().describe("aieng.work-body.v2 blocks: {key, type, content, fallback, bindings}"),
      bindings: records
        .optional()
        .describe(
          "Things the revision uses: {local_key, relation, target: {kind, id}, block_key}; a claim is bound here",
        ),
      parts: z
        .array(
          z.object({
            child_revision_id: id,
            occurrence_key: id.describe("A UUID you keep for this placement"),
            ordinal: z.number().int().min(0).optional().describe("Default: position in this list"),
            role: z.enum(["recommended", "optional"]).optional(),
          }),
        )
        .optional()
        .describe("Children placed at exact revisions (lessons and activities in a module, modules in a course)"),
      outcomes: records.optional().describe("{outcome_key, statement, evidence_rule}"),
      requirements: records
        .optional()
        .describe("{requirement_key, kind, outcome_key or occurrence_key, rationale, options: routes}"),
      prerequisites: records.optional().describe("{required_revision_id, strength, rationale}"),
      runtime: records.optional().describe("{local_key, kind, name, version_spec, resolved_version}"),
      statements: records
        .optional()
        .describe("{kind, statement, support_status, block_key, uses_claim_id}: statements anchored to blocks"),
      origin: z
        .enum(["human", "native_harness", "import", "mc", "agent"])
        .optional()
        .describe("Who wrote it; agent for agent-written content (default human)"),
      metadata: z
        .looseObject({ research: researchBrief.optional() })
        .optional()
        .describe("Body metadata; research is the brief of a work of kind brief"),
    })
    .refine((input) => Boolean(input.markdown) !== Boolean(input.blocks), "give exactly one of markdown or blocks")
    .refine((input) => Boolean(input.work_id) || Boolean(input.kind), "kind is required when creating a work"),
  run: async (context, input) => {
    const head = input.work_id
      ? (input.expected_head ?? (await workIn(context, input.workspace_id, input.work_id)).head)
      : undefined;
    const blocks = input.blocks ?? [
      { key: await textBlockKey(context, head), type: "text", content: { markdown: input.markdown } },
    ];
    const parts = input.parts?.map((part, index) => ({ ...part, ordinal: part.ordinal ?? index }));
    const revision = {
      title: input.title,
      body: { formatVersion: 2, blocks, ...(input.metadata ? { metadata: input.metadata } : {}) },
      ...(input.origin ? { origin: input.origin } : {}),
      ...(input.bindings ? { bindings: input.bindings } : {}),
      ...(parts ? { parts } : {}),
      ...(input.outcomes ? { outcomes: input.outcomes } : {}),
      ...(input.requirements ? { requirements: input.requirements } : {}),
      ...(input.prerequisites ? { prerequisites: input.prerequisites } : {}),
      ...(input.runtime ? { runtime: input.runtime } : {}),
      ...(input.statements ? { assertions: input.statements } : {}),
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

function needed(value: string | undefined, name: string, what: string): string {
  if (!value) throw new ProductError("VALIDATION", `${name} is required to inspect ${what}`);
  return value;
}

/** What no read returns for a saved revision; said in every answer so an absent field is not read as an empty one. */
const notReturned = ["bindings", "parts", "outcomes", "requirements", "prerequisites", "runtime"] as const;

/** One revision as the reads give it: the statement read (title, body, blocks, statements) and the content digest. */
async function revisionView(context: ToolContext, revisionId: string): Promise<JsonObject> {
  const payload = { revision_id: revisionId };
  const [revision, report] = (await Promise.all([
    context.port.read("get_revision", { payload }),
    context.port.read("get_report", { payload }),
  ])) as [JsonObject, JsonObject];
  return {
    revision_id: revisionId,
    work_id: report.workId ?? revision.workId ?? null,
    revision_no: report.revisionNo ?? revision.revisionNo ?? null,
    title: report.title ?? revision.title ?? null,
    content_sha256: revision.contentSha256 ?? null,
    body: report.body ?? revision.body ?? null,
    blocks: report.blocks ?? [],
    statements: report.assertions ?? [],
    datasets: report.datasets ?? [],
    not_returned: [...notReturned],
  };
}

export const inspectAuthoring = defineTool({
  name: "inspect_authoring",
  input: z.object({
    what: z
      .enum(["workspace", "works", "work", "revision", "exposure", "thread"])
      .describe(
        "workspace = your personal workspace id; work = its head revision; exposure = what a release of a root revision would carry; thread = a hand-over conversation",
      ),
    workspace_id: id.optional().describe("works, work and exposure"),
    id: id.optional().describe("work: the work id; revision and exposure: a revision id; thread: the thread id"),
    kind: z.enum(workKinds).optional().describe("works: only this kind"),
    ceiling: z.enum(ceilings).optional().describe("exposure: the intended audience (default workspace)"),
  }),
  run: async (context, input) => {
    switch (input.what) {
      case "workspace":
        return {
          personal_workspace_id: await personalWorkspaceId(context),
          shared_workspaces:
            "not listable: no operation returns the shared workspaces you belong to; use the id you were given",
        };
      case "works": {
        const workspaceId = needed(input.workspace_id, "workspace_id", "works");
        const works = await listWorks(context, workspaceId);
        return {
          workspace_id: workspaceId,
          works: input.kind ? works.filter((work) => work.kind === input.kind) : works,
        };
      }
      case "work": {
        const work = await workIn(
          context,
          needed(input.workspace_id, "workspace_id", "a work"),
          needed(input.id, "id", "a work"),
        );
        return { work, ...(await revisionView(context, work.head)) };
      }
      case "revision":
        return revisionView(context, needed(input.id, "id", "a revision"));
      case "exposure":
        return context.port.read("preview_exposure", {
          workspaceId: needed(input.workspace_id, "workspace_id", "an exposure"),
          payload: { root_revision_id: needed(input.id, "id", "an exposure"), ceiling: input.ceiling ?? "workspace" },
        });
      case "thread":
        return context.port.read("get_thread", {
          ...(input.workspace_id ? { workspaceId: input.workspace_id } : {}),
          payload: { thread_id: needed(input.id, "id", "a thread") },
        });
    }
  },
});

interface Exposure {
  readonly closure_sha256?: string;
  readonly items?: readonly unknown[];
  readonly blockers?: readonly unknown[];
}

/**
 * The hand-over an author can make with the operations that exist: preview what a release would expose, deliver the
 * revision when it answers an accepted brief, and leave the note for the reviewer in a workspace conversation tied to
 * the exact revision. It records no review and marks nothing: no operation holds a "ready for review" state, and the
 * human review (`review_revision`) is deliberately not reachable from any tool.
 */
export const requestReview = defineTool({
  name: "request_review",
  input: z.object({
    workspace_id: id,
    revision_id: id.describe("The exact root revision you hand over"),
    note: z.string().min(1).describe("The hand-over: what it is, why it is done, runs, evidence, open edges, gaps"),
    ceiling: z.enum(ceilings).default("workspace").describe("The audience the author intends"),
    thread_id: id.optional().describe("Continue an earlier hand-over conversation instead of opening one"),
    obligation_id: id.optional().describe("Also deliver the revision against this research obligation"),
  }),
  run: async (context, input) => {
    const workspaceId = input.workspace_id;
    const revision = (await context.port.read("get_revision", { payload: { revision_id: input.revision_id } })) as {
      title?: string;
    };
    const exposure = (await context.port.read("preview_exposure", {
      workspaceId,
      payload: { root_revision_id: input.revision_id, ceiling: input.ceiling },
    })) as Exposure;
    const blockers = exposure.blockers ?? [];
    const delivery = input.obligation_id
      ? await context.port.command("deliver_output", {
          workspaceId,
          payload: { obligation_id: input.obligation_id, revision_id: input.revision_id },
        })
      : undefined;
    const threadId =
      input.thread_id ??
      String(
        (
          await context.port.command("create_thread", {
            workspaceId,
            payload: {
              title: `Review request: ${revision.title ?? input.revision_id}`.slice(0, 200),
              purpose: "authoring",
              visibility: "workspace",
            },
          })
        ).threadId,
      );
    const facts =
      `Revision ${input.revision_id}. Ceiling ${input.ceiling}. Closure ${exposure.closure_sha256 ?? "unknown"}: ` +
      `${exposure.items?.length ?? 0} items, ${blockers.length} blockers.` +
      (delivery ? ` Delivered as ${String(delivery.deliveryId)}.` : "") +
      " No review is recorded by this note.";
    const message = await context.port.command("append_message", {
      workspaceId,
      payload: {
        thread_id: threadId,
        role: "assistant",
        content: { schema: "aieng.message.v1", parts: [{ text: `${input.note}\n\n${facts}` }] },
        context: {
          schema: "aieng.context.v1",
          view: "review_request",
          items: [{ item_key: "revision", reason: "attached", revision_id: input.revision_id }],
        },
      },
    });
    return {
      thread_id: threadId,
      message_id: message.messageId ?? null,
      revision_id: input.revision_id,
      ceiling: input.ceiling,
      closure_sha256: exposure.closure_sha256 ?? null,
      items: exposure.items?.length ?? 0,
      blockers,
      ...(delivery ? { delivery_id: delivery.deliveryId ?? null } : {}),
      review: "not recorded: a person records the release review of this closure and ceiling, then freezes and offers",
    };
  },
});

export const publishBuiltSite = defineTool({
  name: "publish_built_site",
  input: z
    .object({
      workspace_id: id,
      entrypoint: z.string().default("index.html"),
      directory: z.string().optional().describe("Local folder (local MCP server only)"),
      files: z
        .array(z.object({ path: z.string().min(1), content_base64: z.string() }))
        .optional()
        .describe("Remote server: the site's files"),
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
