import { randomUUID } from "node:crypto";
import { z } from "zod";
import { defineTool, personalWorkspaceId } from "./tool-definition.js";

const id = z.guid();

export const searchLearning = defineTool({
  name: "search_learning",
  title: "Search my learning",
  description:
    "Search the caller's private notes, uploaded sources, conversations and the released course material they can read. " +
    "Each result is labelled (private_note, uploaded_source, course_material, conversation) with its exact revision and locator.",
  input: z.object({
    query: z.string().min(1).describe("What to look for"),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  run: (context, input) =>
    context.port.read("search", { payload: { query: input.query, ...(input.limit ? { limit: input.limit } : {}) } }),
});

export const readLesson = defineTool({
  name: "read_lesson",
  title: "Read a lesson",
  description:
    "Render a lesson revision the caller can read: its body, its block tree (stable block keys and types) and the caller's own " +
    "private notes anchored to its blocks.",
  input: z.object({ revision_id: id.describe("Lesson revision id") }),
  run: (context, input) => context.port.read("get_lesson_view", { payload: { revision_id: input.revision_id } }),
});

export const annotateLessonBlock = defineTool({
  name: "annotate_lesson_block",
  title: "Annotate a lesson block",
  description:
    "Save a private note (or an assistant-generated explainer) in the caller's personal workspace, anchored to one block of a " +
    "lesson. Use release_item_id for released course lessons, revision_id for the caller's own lessons.",
  input: z
    .object({
      release_item_id: id.optional(),
      revision_id: id.optional(),
      block_key: id.describe("Stable key of the block being annotated"),
      title: z.string().min(1),
      markdown: z.string().min(1),
      kind: z.enum(["note", "experience"]).default("note").describe("experience = assistant-generated explainer"),
    })
    .refine(
      (input) => Boolean(input.release_item_id) !== Boolean(input.revision_id),
      "give exactly one of release_item_id or revision_id",
    ),
  run: async (context, input) => {
    const workspaceId = await personalWorkspaceId(context);
    const target = input.release_item_id
      ? { kind: "release_item", id: input.release_item_id }
      : { kind: "revision", id: input.revision_id };
    return context.port.command("create_work", {
      workspaceId,
      payload: {
        kind: input.kind,
        slug: `${input.kind}-${randomUUID().slice(0, 8)}`,
        revision: {
          title: input.title,
          origin: input.kind === "experience" ? "agent" : "human",
          body: {
            formatVersion: 2,
            blocks: [{ key: randomUUID(), type: "text", content: { markdown: input.markdown } }],
          },
          bindings: [{ local_key: "anchor", relation: "anchored_to", target, block_key: input.block_key }],
        },
      },
    });
  },
});

export const checkProgress = defineTool({
  name: "check_progress",
  title: "Check course progress",
  description:
    "Show which requirements of the adopted course release are met, computed from active credit (never from chat summaries).",
  input: z.object({ enrollment_id: id }),
  run: (context, input) => context.port.read("progress", { payload: { enrollment_id: input.enrollment_id } }),
});
