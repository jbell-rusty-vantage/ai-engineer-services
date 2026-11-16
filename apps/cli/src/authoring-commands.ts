import {
  type JsonObject,
  ProductError,
  type ProductPort,
  reviewCeilings,
  reviewRequestStatuses,
} from "@aiengineer/service-contracts";
import { argument, numberOption, type Options, oneOf, requiredOption, stringOption } from "./options.js";

function reviewsPayload(options: Options): JsonObject {
  const status = stringOption(options, "status");
  const limit = numberOption(options, "limit");
  return {
    ...(stringOption(options, "revision") ? { revision_id: stringOption(options, "revision") } : {}),
    ...(stringOption(options, "work") ? { work_id: stringOption(options, "work") } : {}),
    ...(status ? { status: oneOf(status, reviewRequestStatuses, "status") } : {}),
    ...(limit ? { limit } : {}),
  };
}

function readyPayload(revisionId: string, options: Options): JsonObject {
  const ceiling = stringOption(options, "ceiling");
  return {
    revision_id: revisionId,
    note: requiredOption(options, "note"),
    ...(ceiling ? { ceiling: oneOf(ceiling, reviewCeilings, "ceiling") } : {}),
    ...(stringOption(options, "thread") ? { thread_id: stringOption(options, "thread") } : {}),
  };
}

/** `aieng authoring <verb>`: reading back what an author saved and handing it to a person. */
export function runAuthoringCommand(
  port: ProductPort,
  verb: string | undefined,
  subject: string | undefined,
  options: Options,
): Promise<unknown> {
  switch (verb) {
    case "workspaces":
      return port.read("list_workspaces", { payload: options.writable === true ? { writable_only: true } : {} });
    case "structure":
      return port.read("get_revision_structure", {
        workspaceId: stringOption(options, "workspace") ?? null,
        payload: { revision_id: argument(subject, "revision id") },
      });
    case "ready":
      return port.command("mark_ready_for_review", {
        workspaceId: requiredOption(options, "workspace"),
        payload: readyPayload(argument(subject, "revision id"), options),
      });
    case "reviews":
      return port.read("list_reviews", {
        workspaceId: requiredOption(options, "workspace"),
        payload: reviewsPayload(options),
      });
    default:
      throw new ProductError("VALIDATION", "usage: aieng authoring workspaces|structure|ready|reviews");
  }
}
