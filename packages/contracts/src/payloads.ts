import { z } from "zod";

/**
 * Edge schemas for operation payloads. They check shape and types at the surface; the database layer remains the
 * authority for permissions, references, catalog rules and integrity. Nested structures are loose so a field the
 * database understands is never silently stripped here.
 */

const id = z.guid();
const optionalId = id.nullish();
const nonBlank = z.string().trim().min(1);
const record = z.record(z.string(), z.unknown());

export const workKinds = [
  "course",
  "track",
  "module",
  "lesson",
  "activity",
  "challenge",
  "project_template",
  "project",
  "report",
  "dataset",
  "decision_definition",
  "action_policy",
  "decision_attempt",
  "brief",
  "experience",
  "component",
  "competency",
  "snippet",
  "note",
  "wiki",
  "document",
  "goal",
  "view",
] as const;

export const workBody = z.looseObject({
  formatVersion: z.union([z.literal(1), z.literal(2)]),
  blocks: z.array(record),
  metadata: record.optional(),
  extensions: record.optional(),
});

export const bindingTarget = z.looseObject({
  kind: z.enum([
    "revision",
    "work",
    "artifact",
    "capture",
    "locator",
    "claim",
    "entity",
    "record",
    "release_item",
    "file_set",
    "assertion",
  ]),
  id,
});

export const revisionBinding = z.looseObject({
  local_key: nonBlank,
  relation: nonBlank,
  target: bindingTarget,
  role: z.string().optional(),
  block_key: id.optional(),
  usage: z.enum(["reference_only", "private_copy", "redistributable", "unknown"]).optional(),
  rights_basis: z.string().optional(),
});

export const revisionSpec = z.looseObject({
  title: nonBlank,
  body: workBody,
  origin: z.enum(["human", "native_harness", "import", "mc", "agent"]).optional(),
  bindings: z.array(revisionBinding).optional(),
  parts: z
    .array(z.looseObject({ occurrence_key: id, child_revision_id: id, ordinal: z.number().int().min(0) }))
    .optional(),
  outcomes: z.array(record).optional(),
  requirements: z.array(record).optional(),
  prerequisites: z.array(record).optional(),
  runtime: z.array(record).optional(),
  /** Statements made in this revision (report findings, estimates, limitations), anchored to its blocks. */
  assertions: z.array(z.looseObject({ kind: nonBlank, statement: nonBlank, support_status: nonBlank })).optional(),
});

export const attemptConditions = z.looseObject({
  schema: z.literal("aieng.attempt-conditions.v1"),
  facet: z.enum(["independent", "assisted", "agent_directed"]),
});

export const evidenceItem = z.looseObject({
  item_key: nonBlank,
  kind: z.enum([
    "project_revision",
    "artifact",
    "response",
    "operational_evidence",
    "defense",
    "repository_commit",
    "deployment",
  ]),
});

export const datasetValueStatuses = [
  "observed",
  "calculated",
  "inferred",
  "estimated",
  "unknown",
  "not_found",
  "undisclosed",
  "conflicting",
  "not_applicable",
] as const;

const money = z.number().min(0);
const instant = z.iso.datetime({ offset: true });
const datasetCell = z.looseObject({
  row_key: id,
  field_key: id,
  value: z.unknown().optional(),
  value_status: z.enum(datasetValueStatuses),
  observed_at: instant.nullish(),
});
const datasetEdits = {
  fields_add: z.array(record).optional(),
  fields_change: z.array(z.looseObject({ field_key: id })).optional(),
  fields_remove: z.array(id).optional(),
  rows_add: z.array(record).optional(),
  rows_remove: z.array(id).optional(),
  cells: z.array(datasetCell).optional(),
  origin_ref: record.optional(),
};
const supportSubject = z.union([
  z.strictObject({ assertion_id: id }),
  z.strictObject({ dataset_work_id: id, row_key: id.optional(), field_key: id.optional(), cell_id: id.optional() }),
]);
const supportTarget = z.looseObject({
  kind: z.enum(["source_revision", "locator", "capture", "claim", "record", "assertion", "cell", "decision"]),
  id,
  answer_key: z.string().optional(),
});

/**
 * Lenses the knowledge search reads. `ours` and `private` hold workspace content and stay behind `search`, which
 * applies the per-passage readability rules.
 */
export const knowledgeLenses = ["corpus", "evidence"] as const;

/** Content kinds of corpus and evidence search items (`passage` and `authored` belong to the other lenses). */
export const knowledgeContentKinds = [
  "chunk",
  "summary",
  "claim",
  "record",
  "profile",
  "timeline",
  "measurement",
  "unit",
  "digest",
  "guidance",
] as const;

/** Payload schemas by operation. Operations absent here are validated by the database layer only. */
export const payloadSchemas = {
  ensure_personal_workspace: z.strictObject({}),
  create_workspace: z.strictObject({ name: nonBlank }),
  grant_member: z.strictObject({ principal_id: id, role: z.enum(["owner", "editor", "reader"]) }),
  revoke_member: z.strictObject({ principal_id: id }),
  create_work: z.strictObject({
    kind: z.enum(workKinds),
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/),
    revision: revisionSpec,
  }),
  revise_work: z.strictObject({ work_id: id, revision: revisionSpec }),
  review_revision: z.strictObject({
    work_id: id,
    revision_id: optionalId,
    review: z.looseObject({ reviewType: nonBlank }),
    dedupe_key: z.string().optional(),
  }),
  freeze_release: z.strictObject({
    root_revision_id: id,
    ceiling: z.enum(["workspace", "named", "public"]),
    approval_event_id: id,
    decisions: z
      .array(
        z.looseObject({ item_key: nonBlank, disposition: z.enum(["include", "snapshot", "reference", "withheld"]) }),
      )
      .optional(),
  }),
  open_distribution: z.strictObject({
    root_work_id: id,
    channel: z.enum(["workspace", "invited", "public_library", "official_catalog"]),
    title: nonBlank,
  }),
  grant_reader: z.strictObject({ distribution_id: id, principal_id: id }),
  offer_release: z.strictObject({ distribution_id: id, release_id: id, terms: record, approval_event_id: id }),
  end_offer: z.strictObject({ offer_id: id, end_kind: z.enum(["retire", "revoke"]), reason: nonBlank }),
  enroll: z.strictObject({ distribution_id: id, update_policy: z.enum(["manual", "auto_compatible"]).optional() }),
  adopt_release: z.strictObject({
    enrollment_id: id,
    offer_id: id,
    transition_id: optionalId,
    reason: z.string().optional(),
  }),
  register_file_set: z.strictObject({
    entrypoint: nonBlank,
    files: z.array(z.strictObject({ path: nonBlank, artifact_id: id })).min(1),
  }),
  record_deployment: z.strictObject({
    target: z.enum(["platform_static", "external"]),
    environment: z.enum(["preview", "published"]).optional(),
    file_set_id: optionalId,
    revision_id: optionalId,
    url: z.url().optional(),
    external_ref: record.optional(),
    snapshot_file_set_id: optionalId,
  }),
  start_attempt: z.strictObject({
    purpose: z.enum(["practice", "official", "diagnostic", "retention_check", "transfer_check"]),
    conditions: attemptConditions,
    task_revision_id: optionalId,
    task_release_item_id: optionalId,
    enrollment_id: optionalId,
    adoption_id: optionalId,
    requirement_key: optionalId,
    option_id: optionalId,
    equivalence_request_id: optionalId,
    environment_session_id: optionalId,
  }),
  submit_attempt: z.strictObject({
    attempt_id: id,
    items: z.array(evidenceItem),
    observed_conditions: record.optional(),
  }),
  get_revision: z.strictObject({ revision_id: id }),
  get_lesson_view: z.strictObject({ revision_id: id }),
  list_works: z.strictObject({}),
  preview_exposure: z.strictObject({ root_revision_id: id, ceiling: z.enum(["workspace", "named", "public"]) }),
  get_offer: z.strictObject({ offer_id: id }),
  list_library: z.strictObject({ channel: z.enum(["public_library", "official_catalog"]).optional() }),
  search: z.strictObject({ query: nonBlank, limit: z.number().int().min(1).max(50).optional() }),
  progress: z.strictObject({ enrollment_id: id }),
  get_result: z.strictObject({ result_id: id }),
  get_thread: z.strictObject({ thread_id: id }),
  // Build 07: research requests, datasets, statements and support
  propose_research: z.strictObject({ revision_id: id }),
  accept_research: z.strictObject({
    revision_id: id,
    execution_origin: z.enum(["mc", "native_harness", "manual"]),
    budget_limit_usd: money.optional(),
    budget_policy: record.optional(),
    trigger: z.enum(["manual", "refresh", "watch"]).optional(),
    revises_acceptance_id: optionalId,
    mc: z.strictObject({ installation_id: id, application_id: nonBlank, mission_id: id, revision_id: id }).optional(),
  }),
  set_acceptance_state: z.strictObject({
    acceptance_id: id,
    state: z.enum(["running", "delivered", "closed", "failed"]),
    spent_usd: money.optional(),
    mc_run_id: optionalId,
  }),
  withdraw_acceptance: z.strictObject({ acceptance_id: id, reason: z.string().optional() }),
  deliver_output: z.strictObject({
    obligation_id: id,
    revision_id: optionalId,
    artifact_id: optionalId,
    file_set_id: optionalId,
    mc_output_revision_id: optionalId,
  }),
  decide_delivery: z.strictObject({
    delivery_id: id,
    decision: z.enum(["accept", "reject"]),
    assessment: record.optional(),
  }),
  create_watch: z.strictObject({
    brief_work_id: id,
    subjects: z.array(record).min(1),
    sources: z.array(z.unknown()).optional(),
    cadence: z.string().regex(/^P(T?[0-9]+[YMWDHS])+$/),
    budget_per_run_usd: money,
    budget_total_usd: money,
    stop_condition: record.optional(),
    target_work_ids: z.array(id).optional(),
  }),
  set_watch_state: z.strictObject({ watch_id: id, state: z.enum(["active", "paused", "stopped"]) }),
  create_dataset: z.strictObject({
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/),
    title: nonBlank,
    note: z.string().optional(),
    origin: z.enum(["human", "native_harness", "import", "mc", "agent"]).optional(),
    ...datasetEdits,
  }),
  edit_dataset: z.strictObject({ dataset_work_id: id, ...datasetEdits }),
  commit_dataset_revision: z.strictObject({
    dataset_work_id: id,
    title: z.string().optional(),
    note: z.string().optional(),
    origin: z.enum(["human", "native_harness", "import", "mc", "agent"]).optional(),
  }),
  propose_dataset_change: z.strictObject({
    dataset_work_id: id,
    base_revision_no: z.number().int().min(1),
    reason: z.enum(["refresh", "correction", "watch", "agent_edit", "import"]),
    dedupe_key: nonBlank,
    acceptance_id: optionalId,
    explanation: z.string().optional(),
    rows_add: z.array(record).optional(),
    rows_remove: z.array(id).optional(),
    cells: z.array(datasetCell).optional(),
    origin_ref: record.optional(),
  }),
  decide_dataset_change: z.strictObject({
    proposal_id: id,
    decision: z.enum(["apply", "reject"]),
    reason: z.string().optional(),
    note: z.string().optional(),
  }),
  add_support: z.strictObject({
    subject: supportSubject,
    role: z.enum(["supports", "contradicts", "qualifies", "context", "calculated_from", "inferred_by"]),
    target: supportTarget.optional(),
    selector: record.optional(),
    excerpt: z.string().max(2000).optional(),
    method: record.optional(),
    verification_ref: z.string().optional(),
  }),
  get_acceptance: z.strictObject({ acceptance_id: id }),
  get_dataset: z.strictObject({
    dataset_work_id: id,
    revision_no: z.number().int().min(1).optional(),
    draft: z.boolean().optional(),
    limit: z.number().int().min(1).max(1000).optional(),
    offset: z.number().int().min(0).optional(),
  }),
  get_dataset_diff: z.union([
    z.strictObject({ proposal_id: id }),
    z.strictObject({
      dataset_work_id: id,
      from_revision_no: z.number().int().min(1),
      to_revision_no: z.number().int().min(1),
    }),
  ]),
  get_support: z.union([z.strictObject({ assertion_id: id }), z.strictObject({ cell_id: id })]),
  get_report: z.strictObject({ revision_id: id }),
  trace_assertion: z.strictObject({ assertion_id: id }),
  trace_reverse: z.strictObject({
    source_revision_ids: z.array(id).optional(),
    cell_ids: z.array(id).optional(),
    claim_id: optionalId,
    capture_id: optionalId,
  }),
  list_watches: z.strictObject({}),
  // Knowledge reads: the industry knowledge base and its evidence
  search_knowledge: z.strictObject({
    query: nonBlank.max(4096),
    lenses: z.array(z.enum(knowledgeLenses)).min(1).optional(),
    tiers: z.array(z.number().int().min(0).max(4)).min(1).optional(),
    spaces: z
      .array(z.string().regex(/^[a-z][a-z0-9_-]{0,62}$/))
      .min(1)
      .optional(),
    kinds: z.array(z.enum(knowledgeContentKinds)).min(1).optional(),
    as_of: instant.optional(),
    limit: z.number().int().min(1).max(50).optional(),
    collapse: z.boolean().optional(),
  }),
  get_claim: z.strictObject({ claim_id: id }),
  get_entity: z.union([z.strictObject({ entity_id: id }), z.strictObject({ library: nonBlank.max(200) })]),
  get_source: z.union([z.strictObject({ source_entity_id: id }), z.strictObject({ name: nonBlank.max(200) })]),
  list_due: z.strictObject({
    as_of: instant.optional(),
    since: instant.optional(),
    release_id: optionalId,
    limit: z.number().int().min(1).max(100).optional(),
  }),
} satisfies Record<string, z.ZodType>;

export type PayloadSchemas = typeof payloadSchemas;

export const databaseValidatedPayload = record;
