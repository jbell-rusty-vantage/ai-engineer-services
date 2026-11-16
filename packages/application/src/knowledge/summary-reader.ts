import type { PayloadSchemas, SummaryEvidence } from "@aiengineer/service-contracts";
import type { z } from "zod";
import type { CallerSession } from "../session.js";
import { asRows, pick, type Row } from "./compact.js";
import type { KnowledgeDatabase } from "./knowledge-database.js";
import { emptyReadError } from "./tenant-context.js";

export type GetSummaryEvidencePayload = z.infer<PayloadSchemas["get_summary_evidence"]>;

const defaultLimit = 50;
const sourceColumns = ["node_id", "chunk_id", "locator_id", "start_ms", "end_ms"];

/**
 * The passages a document summary rests on (`api.summary_evidence`): the document nodes it was written from, with
 * their retrieval chunk, evidence locator and timecodes. A summary without recorded sources is not distinguishable
 * from an unknown summary, so both are `NOT_FOUND`.
 */
export async function readSummaryEvidence(
  database: KnowledgeDatabase,
  session: CallerSession,
  payload: GetSummaryEvidencePayload,
): Promise<SummaryEvidence> {
  const rows = asRows(
    await database.call<Row[] | null>(session, "summary_evidence", { p_summary: payload.summary_id }),
  );
  if (rows.length === 0)
    throw await emptyReadError(database, session, "get_summary_evidence", "a summary with recorded sources");
  const limit = payload.limit ?? defaultLimit;
  return {
    summary_id: payload.summary_id,
    sources: rows.slice(0, limit).map((row) => pick(row, sourceColumns)),
    count: rows.length,
    truncated: rows.length > limit,
  };
}
