import type { FactEvidence, PayloadSchemas } from "@aiengineer/service-contracts";
import type { z } from "zod";
import type { CallerSession } from "../session.js";
import { asRows, clip, pick, type Row, smallJson, text } from "./compact.js";
import type { KnowledgeDatabase } from "./knowledge-database.js";
import { emptyReadError } from "./tenant-context.js";

export type GetFactEvidencePayload = z.infer<PayloadSchemas["get_fact_evidence"]>;

/** A fact with its claim, locator and capture is about 250 tokens; narrow with `scope_key` or raise the limit. */
const defaultLimit = 5;

const factColumns = ["segment_id", "scope_key", "amount", "currency", "unit", "status", "valid_during"];

function toFact(row: Row): Row {
  return {
    ...pick(row, factColumns),
    payload: smallJson(row.payload, 300),
    claim: row.claim_id ? { claim_id: row.claim_id, statement: clip(row.claim_statement, 300) } : null,
    locator: row.locator_id
      ? {
          locator_id: row.locator_id,
          selector_kind: text(row.selector_kind),
          selector: smallJson(row.selector, 300),
          normalized_value: clip(row.normalized_value, 200),
        }
      : null,
    capture: row.capture_id
      ? {
          capture_id: row.capture_id,
          captured_at: text(row.captured_at),
          request_url: text(row.request_url),
          source_url: text(row.source_url),
        }
      : null,
    unit_ref: row.document_node_id
      ? {
          document_node_id: row.document_node_id,
          unit_kind: text(row.unit_kind),
          logical_key: text(row.logical_key),
        }
      : null,
  };
}

/**
 * Where an entity's current facts of one kind come from (`api.fact_locators`): for each fact the claim it rests on,
 * the exact locator in the captured source, the capture (when, which URL) and the document unit. One row per fact and
 * supporting locator, newest validity first.
 */
export async function readFactEvidence(
  database: KnowledgeDatabase,
  session: CallerSession,
  payload: GetFactEvidencePayload,
): Promise<FactEvidence> {
  const rows = asRows(
    await database.call<Row[] | null>(session, "fact_locators", {
      p_entity: payload.entity_id,
      p_stream_kind: payload.stream_kind,
      ...(payload.scope_key ? { p_scope_key: payload.scope_key } : {}),
    }),
  );
  if (rows.length === 0)
    throw await emptyReadError(database, session, "get_fact_evidence", "current facts of that kind on that entity");
  const limit = payload.limit ?? defaultLimit;
  return {
    entity_id: payload.entity_id,
    stream_kind: payload.stream_kind,
    facts: rows.slice(0, limit).map(toFact),
    count: rows.length,
    truncated: rows.length > limit,
  };
}
