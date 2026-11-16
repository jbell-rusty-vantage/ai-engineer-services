import type { DueList, PayloadSchemas } from "@aiengineer/service-contracts";
import type { z } from "zod";
import type { CallerSession } from "../session.js";
import { asRows, pick, type Row, smallJson } from "./compact.js";
import type { KnowledgeDatabase } from "./knowledge-database.js";
import { requireKnowledgeTenantContext } from "./tenant-context.js";

export type ListDuePayload = z.infer<PayloadSchemas["list_due"]>;

const defaultLimit = 25;

const attentionColumns = [
  "policy_id",
  "slug",
  "watch_level",
  "reason",
  "last_sweep_at",
  "budget_usd_per_run",
  "mission",
];
const revalidationColumns = [
  "probe",
  "cell_label",
  "library",
  "resolved_version",
  "newest_version",
  "newest_released_at",
  "last_run_at",
  "reason",
];
const reviewColumns = [
  "release_id",
  "release_no",
  "root_work_id",
  "released_at",
  "claim_id",
  "statement",
  "verdict_at_release",
  "verdict_now",
  "status_now",
  "decided_at",
];
const changeColumns = [
  "change_source",
  "change_kind",
  "learned_at",
  "subject",
  "stream_kind",
  "scope_key",
  "document_title",
  "unit_kind",
  "claim_id",
];
const affectedColumns = [
  "work_id",
  "work_kind",
  "work_slug",
  "revision_id",
  "revision_title",
  "software",
  "release",
  "released_at",
  "breaking",
  "binding",
  "version_spec",
];

/**
 * What is due: attention policies (`api.attention_due`), probes to rerun against a newer library release
 * (`api.probe_revalidation_due`) and releases whose bound claims changed verdict (`api.releases_needing_review`).
 * `since` adds what was learned after a time (`api.changes_since`); `release_id` adds our head revisions affected by
 * a software release (`api.modules_affected_by_release`).
 */
export async function listDue(
  database: KnowledgeDatabase,
  session: CallerSession,
  payload: ListDuePayload,
): Promise<DueList> {
  await requireKnowledgeTenantContext(database, session, "list_due");
  const limit = payload.limit ?? defaultLimit;
  const at = payload.as_of ? { p_as_of: payload.as_of } : {};
  const call = async (functionName: string, args: Record<string, unknown>) =>
    asRows(await database.call<Row[] | null>(session, functionName, args));
  const [attention, revalidation, reviews, changes, affected] = await Promise.all([
    call("attention_due", at),
    call("probe_revalidation_due", at),
    call("releases_needing_review", {}),
    payload.since ? call("changes_since", { p_since: payload.since }) : undefined,
    payload.release_id ? call("modules_affected_by_release", { p_release: payload.release_id }) : undefined,
  ]);
  const head = (rows: readonly Row[], columns: readonly string[]) =>
    rows.slice(0, limit).map((row) => pick(row, columns));
  return {
    as_of: payload.as_of ?? null,
    attention: head(attention, attentionColumns),
    probe_revalidation: head(revalidation, revalidationColumns),
    releases_needing_review: head(reviews, reviewColumns),
    ...(changes
      ? {
          changes: changes.slice(0, limit).map((row) => ({
            ...pick(row, changeColumns),
            old_value: smallJson(row.old_value, 200),
            new_value: smallJson(row.new_value, 200),
          })),
        }
      : {}),
    ...(affected ? { modules_affected: head(affected, affectedColumns) } : {}),
    counts: {
      attention: attention.length,
      probe_revalidation: revalidation.length,
      releases_needing_review: reviews.length,
      ...(changes ? { changes: changes.length } : {}),
      ...(affected ? { modules_affected: affected.length } : {}),
    },
  };
}
