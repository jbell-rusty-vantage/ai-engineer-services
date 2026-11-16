import type { ClaimVerdict, ClaimView, ProbeCell } from "@aiengineer/service-contracts";
import type { CallerSession } from "../session.js";
import { asRows, clip, pick, type Row, smallJson, text } from "./compact.js";
import type { KnowledgeDatabase } from "./knowledge-database.js";
import { emptyReadError } from "./tenant-context.js";

const maximumProbes = 3;
const maximumCells = 12;
const quoteLength = 600;

const candidateColumns = [
  "claim_id",
  "claim_type",
  "statement",
  "status",
  "path",
  "source_role",
  "subjects",
  "document_node_id",
  "document_title",
];
const verifiedColumns = ["receipt_id", "use_decision_id", "verified_at", "executor_version", "verdicts"];
const verdictColumns = [
  "stated_at",
  "quote",
  "stated_by",
  "channel",
  "verdict",
  "probe",
  "review_state",
  "decided_by",
  "decided_at",
  "rationale",
];
const restatementColumns = [
  "claim_id",
  "statement",
  "status",
  "qualified",
  "dropped",
  "probe",
  "original_claim_id",
  "original_statement",
  "original_status",
];
const conflictColumns = [
  "conflict_id",
  "conflict_kind",
  "detected_by",
  "detected_at",
  "first_party_claim_id",
  "first_party_statement",
  "first_party_status",
  "other_claim_id",
  "other_statement",
  "other_status",
  "reconciliation",
];

function verdictsOf(verified: Row | undefined, latest: Row | undefined): ClaimVerdict[] {
  const current = asRows(verified?.verdicts);
  const rows = current.length > 0 ? current : latest ? [latest] : [];
  return rows.map((row) => ({
    probe: text(row.probe),
    verdict: text(row.verdict),
    review_state: text(row.review_state),
  }));
}

function toCell(row: Row): ProbeCell {
  return {
    cell: String(row.cell_label ?? ""),
    outcome: text(row.outcome),
    resolved: smallJson(row.resolved, 400),
    started_at: text(row.started_at),
    locator_id: text(row.locator_id),
  };
}

/** A restatement is a claim atomized from an attribution-framed one; this claim may be either side. */
function restatementsOf(rows: readonly Row[], claimId: string): ClaimView["restatements"] {
  const original = rows.find((row) => row.claim_id === claimId);
  return {
    restated_as: rows
      .filter((row) => row.original_claim_id === claimId)
      .map((row) => pick(row, ["claim_id", "statement", "status", "qualified", "dropped", "probe"])),
    restates: original
      ? {
          claim_id: original.original_claim_id,
          statement: original.original_statement,
          status: original.original_status,
        }
      : null,
  };
}

/**
 * One claim from the `api` claim views: every claim (`claim_candidates`), the admission behind a verified status
 * (`verified_claims`), the latest verdict and who stated it (`claim_verdicts`), restatement links, kept conflicts and
 * the latest probe run per cell (`probe_matrix`).
 */
export async function readClaim(
  database: KnowledgeDatabase,
  session: CallerSession,
  payload: { readonly claim_id: string },
): Promise<ClaimView> {
  const id = payload.claim_id;
  const byClaim = { claim_id: `eq.${id}` };
  const [candidates, verifiedRows, verdictRows, restatements, conflicts] = await Promise.all([
    database.rows<Row>(session, "claim_candidates", { columns: candidateColumns, filters: byClaim, limit: 1 }),
    database.rows<Row>(session, "verified_claims", { columns: verifiedColumns, filters: byClaim, limit: 1 }),
    database.rows<Row>(session, "claim_verdicts", { columns: verdictColumns, filters: byClaim, limit: 1 }),
    database.rows<Row>(session, "claim_restatements", {
      columns: restatementColumns,
      either: `(claim_id.eq.${id},original_claim_id.eq.${id})`,
      limit: 20,
    }),
    database.rows<Row>(session, "claim_conflicts", {
      columns: conflictColumns,
      either: `(first_party_claim_id.eq.${id},other_claim_id.eq.${id})`,
      limit: 20,
    }),
  ]);
  const claim = candidates[0];
  if (!claim) throw await emptyReadError(database, session, "get_claim", "claim");
  const verified = verifiedRows[0];
  const latest = verdictRows[0];
  const verdicts = verdictsOf(verified, latest);
  const probeSlugs = [...new Set(verdicts.flatMap((verdict) => (verdict.probe ? [verdict.probe] : [])))];
  const probes = await Promise.all(
    probeSlugs.slice(0, maximumProbes).map(async (probe) => ({
      probe,
      cells: asRows(await database.call<Row[] | null>(session, "probe_matrix", { p_probe: probe }))
        .slice(0, maximumCells)
        .map(toCell),
    })),
  );
  return {
    claim_id: id,
    statement: String(claim.statement ?? ""),
    claim_type: text(claim.claim_type),
    status: String(claim.status ?? ""),
    path: text(claim.path),
    source_role: text(claim.source_role),
    subjects: Array.isArray(claim.subjects) ? claim.subjects.map(String) : [],
    stated_by: text(latest?.stated_by),
    channel: text(latest?.channel),
    stated_at: text(latest?.stated_at),
    quote: clip(latest?.quote, quoteLength),
    document: claim.document_node_id
      ? { node_id: String(claim.document_node_id), title: text(claim.document_title) }
      : null,
    verified: verified
      ? {
          verified_at: text(verified.verified_at),
          receipt_id: String(verified.receipt_id),
          use_decision_id: text(verified.use_decision_id),
          executor_version: text(verified.executor_version),
        }
      : null,
    verdicts,
    latest_verdict: latest
      ? {
          probe: text(latest.probe),
          verdict: text(latest.verdict),
          review_state: text(latest.review_state),
          decided_by: text(latest.decided_by),
          decided_at: text(latest.decided_at),
          rationale: clip(latest.rationale, quoteLength),
        }
      : null,
    probes,
    restatements: restatementsOf(restatements, id),
    conflicts: conflicts.map((row) => pick(row, conflictColumns)),
  };
}
