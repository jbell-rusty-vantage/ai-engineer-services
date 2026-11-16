import type { JsonObject } from "../port.js";

export interface OperationNote {
  /** What the operation returns. */
  readonly output?: string;
  /** A payload that passes the operation's edge schema (tested). */
  readonly example?: JsonObject;
  /** Schema workspace pages that document it, when that is not `ops/<operation>.md`. */
  readonly pages?: readonly string[];
}

const id = "0193e3c1-6f5a-7c3e-9a1b-2c3d4e5f6a7b";
const otherId = "0193e3c1-6f5a-7c3e-9a1b-2c3d4e5f6a7c";
const textBlock = { key: id, type: "text", content: { markdown: "Why a retry needs an idempotency key." } };

/**
 * Output shapes and examples by operation. Knowledge read outputs are defined by this service
 * (`packages/application/src/knowledge`). The others are the result keys of the database dispatchers, read from
 * `ai-engineer-db-contract` at migration head 20261115120100; the database stays the authority.
 */
export const operationNotes: Readonly<Record<string, OperationNote>> = {
  search_knowledge: {
    output:
      "{ query, lenses, hits: [{ ref, kind, title, snippet, score, lens, tier, space, evidence: { signal, verdict, claims } | null, read_more: { operation, payload } | null, entity_id?, document_id?, observed_at? }], note? }",
    example: { query: "structured output retries", lenses: ["evidence"], limit: 5 },
    pages: ["functions/api/search_knowledge.md", "functions/api/search_unified.md"],
  },
  get_claim: {
    output:
      "{ claim_id, statement, claim_type, status, path, source_role, subjects, stated_by, channel, stated_at, quote, document, verified: { verified_at, receipt_id, use_decision_id, executor_version } | null, verdicts: [{ probe, verdict, review_state }], latest_verdict, probes: [{ probe, cells: [{ cell, outcome, resolved, started_at, locator_id }] }], restatements: { restated_as, restates }, conflicts }",
    example: { claim_id: id },
    pages: [
      "relations/api/claim_candidates.md",
      "relations/api/verified_claims.md",
      "relations/api/claim_verdicts.md",
      "relations/api/claim_restatements.md",
      "relations/api/claim_conflicts.md",
      "functions/api/probe_matrix.md",
    ],
  },
  get_entity: {
    output:
      "by entity_id: { kind: 'entity_card', entity, aliases, facts, relationships, events, sources, truncated }; by library: { kind: 'library_dossier', library, releases, claims, open_community_claims, probes, sources, as_of }",
    example: { library: "langgraph" },
    pages: ["functions/api/entity_card.md", "functions/api/library_dossier.md"],
  },
  get_fact_evidence: {
    output:
      "{ entity_id, stream_kind, facts: [{ segment_id, scope_key, amount, currency, unit, status, payload, valid_during, claim: { claim_id, statement } | null, locator: { locator_id, selector_kind, selector, normalized_value } | null, capture: { capture_id, captured_at, request_url, source_url } | null, unit_ref: { document_node_id, unit_kind, logical_key } | null }], count, truncated }",
    example: { entity_id: id, stream_kind: "offering_price" },
    pages: ["functions/api/fact_locators.md"],
  },
  list_entity_changes: {
    output:
      "{ entity_id, after_seq, through_seq, changes: [{ change_kind: opened | closed, item_kind: segment | event | relationship, item_id, knowledge_seq, details }], counts, truncated }",
    example: { entity_id: id, after_seq: 0 },
    pages: ["functions/api/what_changed.md", "functions/api/knowledge_head.md"],
  },
  get_summary_evidence: {
    output: "{ summary_id, sources: [{ node_id, chunk_id, locator_id, start_ms, end_ms }], count, truncated }",
    example: { summary_id: id },
    pages: ["functions/api/summary_evidence.md"],
  },
  get_source: {
    output:
      "{ source: { source_entity_id, name, kind, platform, url }, assessments: [{ topic, as_of, source_role_code, conflict_of_interest, method_disclosure, claims_observed, claims_checked, confirmed, qualified, refuted, self_checked, median_lead_days, noise_ratio, authority_score, recommended_watch_level, current_watch_level, rationale }], track_record: [{ claim_id, statement, status, stated_at, first_party_at, verdict, probe }], track_record_truncated }",
    example: { name: "LangChain blog" },
    pages: ["relations/api/source_registry.md", "relations/api/source_track_record.md"],
  },
  list_due: {
    output:
      "{ as_of, attention: [{ policy_id, slug, watch_level, reason, last_sweep_at, budget_usd_per_run, mission }], probe_revalidation: [{ probe, cell_label, library, resolved_version, newest_version, newest_released_at, reason }], releases_needing_review: [{ release_id, release_no, root_work_id, released_at, claim_id, statement, verdict_at_release, verdict_now, status_now, decided_at }], changes?, modules_affected?, counts }",
    example: { since: "2026-11-01T00:00:00Z" },
    pages: [
      "functions/api/attention_due.md",
      "functions/api/probe_revalidation_due.md",
      "functions/api/releases_needing_review.md",
      "functions/api/changes_since.md",
      "functions/api/modules_affected_by_release.md",
    ],
  },
  ensure_personal_workspace: { output: "{ workspaceId }", example: {} },
  create_workspace: { output: "{ workspaceId }", example: { name: "Agent orchestration course" } },
  grant_member: { output: "{ granted }", example: { principal_id: id, role: "editor" } },
  revoke_member: { output: "{ revoked }" },
  create_work: {
    output: "{ workId, revisionId }",
    example: {
      kind: "module",
      slug: "reliable-tool-calls",
      revision: {
        title: "Reliable tool calls",
        body: { formatVersion: 2, blocks: [textBlock] },
        parts: [{ occurrence_key: otherId, child_revision_id: id, ordinal: 0 }],
      },
    },
  },
  revise_work: {
    output: "{ workId, revisionId }; send expectedHead (the current head) beside the payload",
    example: {
      work_id: id,
      revision: { title: "Reliable tool calls", body: { formatVersion: 2, blocks: [textBlock] } },
    },
  },
  list_works: { output: "[{ id, kind, slug, head }]", example: {} },
  get_revision: {
    output: "{ id, workId, revisionNo, title, body, contentSha256, purged }",
    example: { revision_id: id },
  },
  preview_exposure: {
    output:
      "{ root_revision_id, ceiling, items: [{ item_key, kind, id, binding_id, disposition }], blockers, closure_sha256 }",
    example: { root_revision_id: id, ceiling: "named" },
  },
  review_revision: {
    output: "{ eventId }",
    example: {
      work_id: id,
      revision_id: otherId,
      review: {
        reviewType: "release_review",
        decision: "approve",
        closure_sha256: "<from preview_exposure>",
        ceiling: "named",
      },
    },
  },
  freeze_release: {
    output: "{ releaseId, releaseNo, manifestArtifactId, manifestText, objectPath }",
    example: { root_revision_id: id, ceiling: "named", approval_event_id: otherId },
  },
  open_distribution: {
    output: "{ distributionId }",
    example: { root_work_id: id, channel: "invited", title: "Cohort 1" },
  },
  grant_reader: { output: "{ granted }", example: { distribution_id: id, principal_id: otherId } },
  offer_release: {
    output: "{ offerId, offerNo }",
    example: {
      distribution_id: id,
      release_id: otherId,
      approval_event_id: id,
      terms: {
        study: true,
        adapt: "private",
        redistribute: "none",
        derived_work: "none",
        attribution: "AI Engineer",
        updates: "corrections_included",
        endorsement: "creator",
      },
    },
  },
  end_offer: { output: "{ ended }", example: { offer_id: id, end_kind: "retire", reason: "superseded by release 2" } },
  get_offer: {
    output: "{ offerId, terms, items: [{ releaseItemId, itemKey, disposition, revisionId, artifactId }] }",
    example: { offer_id: id },
  },
  list_library: { output: "[{ distributionId, title, channel, offerId }]", example: { channel: "public_library" } },
  register_file_set: { output: "{ fileSetId, treeSha256 }" },
  record_deployment: { output: "{ deploymentId, url, status }" },
  revoke_asset: { output: "{ revoked }" },
  search: {
    output: "[{ label, passageId, revisionId, workKind, locator, snippet, rank, lens, tier, channels }]",
    example: { query: "idempotency keys", limit: 5 },
  },
  get_lesson_view: { example: { revision_id: id } },
  enroll: { output: "{ enrollmentId }", example: { distribution_id: id } },
  adopt_release: { output: "{ adoptionId, sequenceNo }", example: { enrollment_id: id, offer_id: otherId } },
  progress: {
    output: "{ enrollmentId, adoptionId, requirements: [{ requirementKey, kind, met }] }",
    example: { enrollment_id: id },
  },
  start_attempt: {
    output: "{ attemptId }",
    example: {
      purpose: "practice",
      conditions: { schema: "aieng.attempt-conditions.v1", facet: "assisted" },
      task_release_item_id: id,
    },
  },
  submit_attempt: {
    output: "{ submissionId, manifestArtifactId, closureSha256, manifestText, objectPath }",
    example: { attempt_id: id, items: [{ item_key: "notes", kind: "response", revision_id: otherId }] },
  },
  open_appeal: { output: "{ appealId }" },
  finalize_result: { output: "{ finalized }" },
  resolve_appeal: { output: "{ state, newResultId }" },
  grant_evidence: { output: "{ grantId }" },
  propose_equivalence: { output: "{ equivalenceRequestId, state }" },
  decide_equivalence: { output: "{ state }" },
  request_environment: { output: "{ environmentSessionId, status }" },
  propose_research: {
    output: "{ valid, problems, eventId? }",
    example: { revision_id: id },
  },
  accept_research: {
    output:
      "{ acceptanceId, acceptanceNo, supersededAcceptanceId, obligations: { <obligation key>: <obligation id> } }",
    example: { revision_id: id, execution_origin: "native_harness", budget_limit_usd: 5 },
  },
  set_acceptance_state: { output: "{ state }", example: { acceptance_id: id, state: "running" } },
  withdraw_acceptance: { output: "{ state, eventId }", example: { acceptance_id: id } },
  deliver_output: { output: "{ deliveryId }", example: { obligation_id: id, revision_id: otherId } },
  decide_delivery: { output: "{ state, fulfilled }", example: { delivery_id: id, decision: "accept" } },
  create_watch: { output: "{ watchId, state }" },
  set_watch_state: { output: "{ state }", example: { watch_id: id, state: "paused" } },
  list_watches: {
    output: "[{ watchId, briefWorkId, subjects, cadence, state, budgetPerRunUsd, budgetTotalUsd, targets, runs }]",
    example: {},
  },
  add_support: {
    output: "{ supportId }",
    example: { subject: { assertion_id: id }, role: "supports", target: { kind: "claim", id: otherId } },
  },
  get_support: { output: "[{ supportId, role, selector, excerpt, method, ... }]", example: { assertion_id: id } },
  get_acceptance: {
    output:
      "{ acceptanceId, acceptanceNo, briefRevisionId, state, budgetLimitUsd, spentUsd, executionOrigin, obligations, ... }",
    example: { acceptance_id: id },
  },
  trace_assertion: {
    output: "{ assertionId, statement, supportStatus, revisionId, ... }",
    example: { assertion_id: id },
  },
  trace_reverse: { example: { source_revision_ids: [id] } },
  get_report: { output: "{ revisionId, workId, revisionNo, title, body, ... }", example: { revision_id: id } },
  create_dataset: {
    output: "{ workId, revisionId, revisionNo }",
    example: {
      slug: "output-prices",
      title: "Output prices",
      fields_add: [{ field_key: id, name: "output_usd_per_mtok", value_type: "number", meaning: "Output price" }],
      rows_add: [{ row_key: otherId, label: "example model" }],
      cells: [{ row_key: otherId, field_key: id, value: 10, value_status: "observed" }],
    },
  },
  edit_dataset: {
    output: "{ draftRevisionNo, changedVersions }",
    example: {
      dataset_work_id: id,
      cells: [{ row_key: otherId, field_key: id, value: 12, value_status: "observed" }],
    },
  },
  commit_dataset_revision: { output: "{ workId, revisionId, revisionNo }", example: { dataset_work_id: id } },
  propose_dataset_change: {
    output: "{ proposalId, state, duplicate, unchanged, summary?, stagedCells? }",
    example: {
      dataset_work_id: id,
      base_revision_no: 1,
      reason: "correction",
      dedupe_key: "price-correction-2026-11",
      cells: [{ row_key: otherId, field_key: id, value: 12, value_status: "observed" }],
    },
  },
  decide_dataset_change: {
    output: "{ state: applied | rejected | stale, revisionId?, revisionNo? }",
    example: { proposal_id: id, decision: "apply" },
  },
  get_dataset: {
    output: "{ datasetWorkId, revisionNo, draft, revisionId, cellsSha256, fields, rowCount, rows }",
    example: { dataset_work_id: id },
  },
  get_dataset_diff: { example: { dataset_work_id: id, from_revision_no: 1, to_revision_no: 2 } },
  create_client_grant: { output: "{ grantId, token }" },
  revoke_client_grant: { output: "{ revoked }" },
  set_control: { output: "{ updated }" },
  preview_removal: { output: "{ removalId, impact, state }" },
  confirm_removal: { output: "{ removalId, purgedRevisions, deletedPassages }" },
  create_connection: { output: "{ connectionId }" },
  create_thread: { output: "{ threadId }" },
  append_message: { output: "{ messageId, seq, contextSnapshotId }" },
};
