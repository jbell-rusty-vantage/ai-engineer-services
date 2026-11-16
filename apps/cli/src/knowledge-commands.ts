import { type JsonObject, ProductError, type ProductPort } from "@aiengineer/service-contracts";
import { argument, listOption, numberOption, type Options, stringOption } from "./options.js";

function searchPayload(query: string, options: Options): JsonObject {
  const tiers = listOption(options, "tier")?.map(Number);
  const limit = numberOption(options, "limit");
  return {
    query,
    ...(listOption(options, "lens") ? { lenses: listOption(options, "lens") } : {}),
    ...(tiers ? { tiers } : {}),
    ...(listOption(options, "space") ? { spaces: listOption(options, "space") } : {}),
    ...(listOption(options, "kind") ? { kinds: listOption(options, "kind") } : {}),
    ...(stringOption(options, "as-of") ? { as_of: stringOption(options, "as-of") } : {}),
    ...(limit ? { limit } : {}),
    ...(options.collapse === false ? { collapse: false } : {}),
  };
}

function duePayload(options: Options): JsonObject {
  const limit = numberOption(options, "limit");
  return {
    ...(stringOption(options, "as-of") ? { as_of: stringOption(options, "as-of") } : {}),
    ...(stringOption(options, "since") ? { since: stringOption(options, "since") } : {}),
    ...(stringOption(options, "release") ? { release_id: stringOption(options, "release") } : {}),
    ...(limit ? { limit } : {}),
  };
}

function factsPayload(entityId: string, options: Options): JsonObject {
  const limit = numberOption(options, "limit");
  const kind = stringOption(options, "kind");
  if (!kind)
    throw new ProductError("VALIDATION", "--kind <stream-kind> is required (a stream_kind of the entity card)");
  return {
    entity_id: entityId,
    stream_kind: kind,
    ...(stringOption(options, "scope") ? { scope_key: stringOption(options, "scope") } : {}),
    ...(limit ? { limit } : {}),
  };
}

function changesPayload(entityId: string, options: Options): JsonObject {
  const after = numberOption(options, "after");
  const through = numberOption(options, "through");
  const limit = numberOption(options, "limit");
  return {
    entity_id: entityId,
    ...(after === undefined ? {} : { after_seq: after }),
    ...(through === undefined ? {} : { through_seq: through }),
    ...(limit ? { limit } : {}),
  };
}

/** `aieng knowledge <verb>`: friendly forms of the knowledge read operations. */
export function runKnowledgeCommand(
  port: ProductPort,
  verb: string | undefined,
  subject: string | undefined,
  options: Options,
): Promise<unknown> {
  const read = (operation: string, payload: JsonObject) => port.read(operation, { payload });
  const library = stringOption(options, "library");
  const name = stringOption(options, "name");
  switch (verb) {
    case "search":
      return read("search_knowledge", searchPayload(argument(subject, "query"), options));
    case "claim":
      return read("get_claim", { claim_id: argument(subject, "claim id") });
    case "entity":
      return read("get_entity", library ? { library } : { entity_id: argument(subject, "entity id or --library") });
    case "facts":
      return read("get_fact_evidence", factsPayload(argument(subject, "entity id"), options));
    case "changes":
      return read("list_entity_changes", changesPayload(argument(subject, "entity id"), options));
    case "summary": {
      const limit = numberOption(options, "limit");
      return read("get_summary_evidence", { summary_id: argument(subject, "summary id"), ...(limit ? { limit } : {}) });
    }
    case "source":
      return read(
        "get_source",
        name ? { name } : { source_entity_id: argument(subject, "source entity id or --name") },
      );
    case "due":
      return read("list_due", duePayload(options));
    default:
      throw new ProductError(
        "VALIDATION",
        "usage: aieng knowledge search|claim|entity|facts|changes|summary|source|due",
      );
  }
}
