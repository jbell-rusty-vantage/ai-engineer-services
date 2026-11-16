import { z } from "zod";
import { defineTool, personalWorkspaceId } from "./tool-definition.js";

const id = z.guid();

export const startAttempt = defineTool({
  name: "start_attempt",
  input: z.object({
    purpose: z
      .enum(["practice", "official", "diagnostic", "retention_check", "transfer_check"])
      .describe("official also needs enrollment_id, adoption_id, requirement_key and option_id"),
    facet: z.enum(["independent", "assisted", "agent_directed"]).describe("Declare honestly how the work is done"),
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
