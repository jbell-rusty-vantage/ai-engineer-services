import { type PayloadSchemas, ProductError, type SourceView } from "@aiengineer/service-contracts";
import type { z } from "zod";
import type { CallerSession } from "../session.js";
import { clip, pick, type Row, text } from "./compact.js";
import type { KnowledgeDatabase } from "./knowledge-database.js";

export type GetSourcePayload = z.infer<PayloadSchemas["get_source"]>;

const trackRecordLimit = 40;

const registryColumns = [
  "source_entity_id",
  "source_kind",
  "source",
  "platform",
  "url",
  "topic",
  "as_of",
  "source_role_code",
  "conflict_of_interest",
  "method_disclosure",
  "claims_observed",
  "claims_checked",
  "confirmed",
  "qualified",
  "refuted",
  "self_checked",
  "median_lead_days",
  "noise_ratio",
  "authority_score",
  "recommended_watch_level",
  "current_watch_level",
  "rationale",
];
const assessmentColumns = registryColumns.filter(
  (column) => !["source_entity_id", "source_kind", "source", "platform", "url", "rationale"].includes(column),
);
const trackRecordColumns = [
  "source_entity_id",
  "source",
  "source_kind",
  "claim_id",
  "statement",
  "status",
  "stated_at",
  "first_party_at",
  "verdict",
  "probe",
];
const claimColumns = ["claim_id", "statement", "status", "stated_at", "first_party_at", "verdict", "probe"];

/**
 * One source: its latest assessment per topic (`api.source_registry`) and the claims it stated with their latest
 * verdicts (`api.source_track_record`), the rows behind the assessment's counts. A source may have a track record
 * before it has an assessment.
 */
export async function readSource(
  database: KnowledgeDatabase,
  session: CallerSession,
  payload: GetSourcePayload,
): Promise<SourceView> {
  const named = "name" in payload;
  const assessments = await database.rows<Row>(session, "source_registry", {
    columns: registryColumns,
    filters: named ? { source: `ilike.${payload.name}` } : { source_entity_id: `eq.${payload.source_entity_id}` },
    order: "as_of.desc",
    limit: 20,
  });
  const sourceId = named ? text(assessments[0]?.source_entity_id) : payload.source_entity_id;
  const claims = await database.rows<Row>(session, "source_track_record", {
    columns: trackRecordColumns,
    filters: sourceId ? { source_entity_id: `eq.${sourceId}` } : { source: `ilike.${named ? payload.name : ""}` },
    limit: trackRecordLimit + 1,
  });
  const identity = assessments[0] ?? claims[0];
  if (!identity) throw new ProductError("NOT_FOUND", "source");
  const sameSource = (row: Row) => row.source_entity_id === identity.source_entity_id;
  return {
    source: {
      source_entity_id: String(identity.source_entity_id),
      name: text(identity.source),
      kind: text(identity.source_kind),
      ...(assessments[0] ? { platform: text(identity.platform), url: text(identity.url) } : {}),
    },
    assessments: assessments.filter(sameSource).map((row) => ({
      ...pick(row, assessmentColumns),
      rationale: clip(row.rationale, 400),
    })),
    track_record: claims
      .filter(sameSource)
      .slice(0, trackRecordLimit)
      .map((row) => pick(row, claimColumns)),
    track_record_truncated: claims.length > trackRecordLimit,
  };
}
