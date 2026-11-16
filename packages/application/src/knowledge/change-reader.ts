import { type EntityChanges, type PayloadSchemas, ProductError } from "@aiengineer/service-contracts";
import type { z } from "zod";
import type { CallerSession } from "../session.js";
import { asRows, pick, type Row, smallJson } from "./compact.js";
import type { KnowledgeDatabase } from "./knowledge-database.js";
import { requireVisibleKnowledge } from "./tenant-context.js";

export type ListEntityChangesPayload = z.infer<PayloadSchemas["list_entity_changes"]>;

/** A change with its details is about 125 tokens. */
const defaultLimit = 10;

/** The columns of each changed row worth an agent's tokens; the function returns the whole row as `details`. */
const detailColumns: Readonly<Record<string, readonly string[]>> = {
  segment: ["stream_id", "amount", "currency", "unit", "status", "valid_during", "belief", "ref_entity_id"],
  event: ["event_id", "occurred_during", "occurrence_mode"],
  relationship: ["kind", "from_entity_id", "to_entity_id", "qualifier"],
};

function toChange(row: Row): Row {
  const details = (row.details ?? {}) as Row;
  const columns = detailColumns[String(row.item_kind)] ?? [];
  return {
    ...pick(row, ["change_kind", "item_kind", "item_id", "knowledge_seq"]),
    details: {
      ...pick(details, columns),
      ...(details.primary_claim_id ? { claim_id: details.primary_claim_id } : {}),
      ...(details.payload ? { payload: smallJson(details.payload, 200) } : {}),
      ...(details.properties && Object.keys(details.properties).length > 0
        ? { properties: smallJson(details.properties, 200) }
        : {}),
    },
  };
}

/**
 * What changed for one entity (`api.what_changed`): the facts, events and relationships opened or closed after
 * `after_seq` and up to `through_seq` (default: the knowledge head), newest first. A range with no change is an
 * answer; `through_seq` is returned so the next call can start from it.
 */
export async function listEntityChanges(
  database: KnowledgeDatabase,
  session: CallerSession,
  payload: ListEntityChangesPayload,
): Promise<EntityChanges> {
  const operation = "list_entity_changes";
  const after = payload.after_seq ?? 0;
  const through = payload.through_seq ?? (await requireVisibleKnowledge(database, session, operation));
  if (through <= after) throw new ProductError("VALIDATION", "through_seq must be greater than after_seq");
  const rows = asRows(
    await database.call<Row[] | null>(session, "what_changed", {
      p_entity: payload.entity_id,
      p_k1: after,
      p_k2: through,
    }),
  );
  // "Nothing changed" is an answer only when the session sees the knowledge base (already known when the head was read).
  if (rows.length === 0 && payload.through_seq !== undefined)
    await requireVisibleKnowledge(database, session, operation);
  const newestFirst = [...rows].sort((left, right) => Number(right.knowledge_seq) - Number(left.knowledge_seq));
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = `${row.change_kind} ${row.item_kind}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const limit = payload.limit ?? defaultLimit;
  return {
    entity_id: payload.entity_id,
    after_seq: after,
    through_seq: through,
    changes: newestFirst.slice(0, limit).map(toChange),
    counts,
    truncated: rows.length > limit,
  };
}
