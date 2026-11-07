import { z } from "zod";
import { defineTool, personalWorkspaceId } from "./tool-definition.js";

const id = z.guid();

export const startAttempt = defineTool({
  name: "start_attempt",
  title: "Start an attempt",
  description:
    "Start a practice or official attempt at a task with declared conditions (facet: independent, assisted or agent_directed). " +
    "Official attempts need the enrollment, adopted release, requirement key and an approved option; a learner's own project " +
    "or challenge also needs an approved equivalence request.",
  input: z.object({
    purpose: z.enum(["practice", "official", "diagnostic", "retention_check", "transfer_check"]),
    facet: z.enum(["independent", "assisted", "agent_directed"]),
    assistance: z.string().optional().describe("e.g. coach, build_with_me, none"),
    task_revision_id: id.optional().describe("A task in the caller's own workspace"),
    task_release_item_id: id.optional().describe("A released course task"),
    enrollment_id: id.optional(),
    adoption_id: id.optional(),
    requirement_key: id.optional(),
    option_id: id.optional(),
    equivalence_request_id: id.optional(),
    environment_session_id: id.optional(),
  }),
  run: async (context, { facet, assistance, ...ids }) =>
    context.port.command("start_attempt", {
      workspaceId: await personalWorkspaceId(context),
      payload: {
        ...ids,
        conditions: { schema: "aieng.attempt-conditions.v1", facet, ...(assistance ? { assistance } : {}) },
      },
    }),
});

export const submitAttempt = defineTool({
  name: "submit_attempt",
  title: "Submit an attempt",
  description:
    "Freeze a submission for an attempt. Evidence items point at fixed things: a project revision, a deployment, a file set, an " +
    "artifact, a conversation message or an external commit/URL. Later edits never change a submission.",
  input: z.object({
    attempt_id: id,
    items: z
      .array(
        z.object({
          item_key: z.string().min(1),
          kind: z.enum([
            "project_revision",
            "artifact",
            "response",
            "operational_evidence",
            "defense",
            "repository_commit",
            "deployment",
          ]),
          revision_id: id.optional(),
          artifact_id: id.optional(),
          message_id: id.optional(),
          file_set_id: id.optional(),
          deployment_id: id.optional(),
          external_ref: z.record(z.string(), z.unknown()).optional(),
          availability: z.enum(["preserved", "reference_only", "unavailable"]).optional(),
        }),
      )
      .min(1),
  }),
  run: async (context, input) =>
    context.port.command("submit_attempt", { workspaceId: await personalWorkspaceId(context), payload: input }),
});
