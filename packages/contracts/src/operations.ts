import type { z } from "zod";
import { databaseValidatedPayload, payloadSchemas } from "./payloads.js";

export type OperationKind = "command" | "read";

/** Client-grant scopes; the database enforces the same mapping for every request. */
export type OperationScope = "read" | "author" | "learn" | "library" | "assess";

/**
 * `public` operations are reachable through every surface. `composite` operations are only invoked by an application
 * composite (for example `register_asset` inside the asset upload, which also stores and verifies the bytes).
 */
export type OperationExposure = "public" | "composite";

export interface OperationDefinition {
  readonly name: string;
  readonly kind: OperationKind;
  readonly scope: OperationScope;
  readonly exposure: OperationExposure;
  readonly summary: string;
  readonly payload: z.ZodType;
}

type Row = readonly [
  name: string,
  kind: OperationKind,
  scope: OperationScope,
  summary: string,
  exposure?: OperationExposure,
];

const rows: readonly Row[] = [
  ["ensure_personal_workspace", "command", "author", "Create (once) and return the caller's personal workspace"],
  ["create_workspace", "command", "author", "Create a shared workspace owned by the caller"],
  ["grant_member", "command", "author", "Grant a workspace role (owner only)"],
  ["revoke_member", "command", "author", "Revoke a workspace role; the last owner cannot be revoked"],
  ["create_work", "command", "author", "Create a work and its first sealed revision"],
  ["revise_work", "command", "author", "Save a new sealed revision against the expected head"],
  ["review_revision", "command", "author", "Record a review event (human-only review types refuse agent clients)"],
  [
    "freeze_release",
    "command",
    "author",
    "Freeze a release closure at an audience ceiling; the platform stores its manifest",
  ],
  ["open_distribution", "command", "author", "Open a distribution channel for a root work"],
  ["grant_reader", "command", "author", "Invite a reader to an invited distribution"],
  ["offer_release", "command", "author", "Offer a frozen release in a distribution under exact terms"],
  ["end_offer", "command", "author", "Retire or revoke an offer"],
  ["register_asset", "command", "author", "Register a pending artifact (used by the asset upload)", "composite"],
  ["revoke_asset", "command", "author", "Revoke a workspace's access to an artifact"],
  [
    "register_file_set",
    "command",
    "author",
    "Register a multi-file set (e.g. a harness-built site) from uploaded artifacts",
  ],
  ["record_deployment", "command", "author", "Record a platform-static or external deployment"],
  ["create_client_grant", "command", "author", "Mint a scoped, expiring client grant for a CLI, MCP or harness client"],
  ["revoke_client_grant", "command", "author", "Revoke a client grant"],
  ["preview_removal", "command", "library", "Preview the impact of removing a work"],
  ["confirm_removal", "command", "library", "Execute a previewed removal"],
  ["set_control", "command", "library", "Exclude a work from search/context or toggle semantic indexing"],
  ["create_connection", "command", "library", "Connect an external notes/document system"],
  ["create_thread", "command", "library", "Start a product conversation"],
  ["append_message", "command", "library", "Append a message with its exact context"],
  ["enroll", "command", "learn", "Enroll in a course distribution from the personal workspace"],
  ["adopt_release", "command", "learn", "Adopt an offered release"],
  ["start_attempt", "command", "learn", "Start a practice or official attempt under declared conditions"],
  ["submit_attempt", "command", "learn", "Freeze a submission; the platform stores its manifest"],
  ["open_appeal", "command", "learn", "Appeal an assessment result"],
  ["grant_evidence", "command", "learn", "Grant someone read access to your learning evidence"],
  ["propose_equivalence", "command", "learn", "Ask for your own project or challenge to count toward requirements"],
  [
    "request_environment",
    "command",
    "learn",
    "Request a working environment (local harness, browser runtime, cloud sandbox)",
  ],
  ["finalize_result", "command", "assess", "Finalize a provisional result (course maintainer)"],
  ["resolve_appeal", "command", "assess", "Resolve an appeal (course maintainer)"],
  ["decide_equivalence", "command", "assess", "Approve or reject an equivalence request (course maintainer)"],
  ["invite_guardian", "command", "author", "Invite a guardian (youth accounts)"],
  ["consent_guardian", "command", "author", "Record guardian consent and help scope"],
  ["authorize_processing", "command", "author", "Authorize an external processor for your (or a youth's) data"],
  ["get_revision", "read", "read", "Read a revision you can access (own or released)"],
  ["get_lesson_view", "read", "read", "Render a lesson's blocks with your private learner layer"],
  ["list_works", "read", "read", "List works in a workspace"],
  ["preview_exposure", "read", "read", "Preview what a release would expose at a ceiling"],
  ["get_offer", "read", "read", "Read an offer's visible items and terms"],
  ["list_library", "read", "read", "List the public library or official catalog"],
  ["search", "read", "read", "Search your private material, released course material and conversations"],
  ["progress", "read", "read", "Course progress computed from active credit"],
  ["get_result", "read", "read", "Read an assessment result with its explanations"],
  ["get_thread", "read", "read", "Read a conversation"],
  // Build 07: research requests, datasets, statements and support
  [
    "propose_research",
    "command",
    "author",
    "Validate a research brief revision as a proposal (plan, outputs, budget, window)",
  ],
  [
    "accept_research",
    "command",
    "author",
    "Accept an exact research proposal with a budget and execution origin (people only)",
  ],
  [
    "set_acceptance_state",
    "command",
    "author",
    "Move accepted research through running/delivered/closed and record spend",
  ],
  ["withdraw_acceptance", "command", "author", "Withdraw accepted research (people only)"],
  ["deliver_output", "command", "author", "Offer an output revision, file or file set against a research obligation"],
  [
    "decide_delivery",
    "command",
    "author",
    "Accept or reject a delivered output (people only; producers cannot accept their own)",
  ],
  [
    "create_watch",
    "command",
    "author",
    "Opt in to a recurring refresh with cadence, budget and stop condition (people only)",
  ],
  ["set_watch_state", "command", "author", "Pause, resume (people only) or stop a watch"],
  [
    "create_dataset",
    "command",
    "author",
    "Create an editable dataset with fields, rows and values; commits revision 1",
  ],
  [
    "edit_dataset",
    "command",
    "author",
    "Edit the dataset draft: fields, rows and values (unchanged values add nothing)",
  ],
  ["commit_dataset_revision", "command", "author", "Freeze the dataset draft as the next fixed revision"],
  [
    "propose_dataset_change",
    "command",
    "author",
    "Propose a reviewable change (refresh, correction, watch); duplicates and no-ops are silent",
  ],
  [
    "decide_dataset_change",
    "command",
    "author",
    "Apply or reject a dataset change proposal (people only); applying commits a revision",
  ],
  [
    "add_support",
    "command",
    "author",
    "Record support, contradiction, a qualifier, a calculation or an inference for a statement or value",
  ],
  ["get_acceptance", "read", "read", "Read accepted research with its obligations, deliveries and fulfillment"],
  ["get_dataset", "read", "read", "Read a dataset revision (or the draft) with value statuses and support counts"],
  ["get_dataset_diff", "read", "read", "Compare two dataset revisions, or a proposal against its base"],
  ["get_support", "read", "read", "Read the support behind a statement or a dataset value"],
  ["get_report", "read", "read", "Read a report revision with its statements, support counts and pinned datasets"],
  [
    "trace_assertion",
    "read",
    "read",
    "Trace a statement to its evidence: quotes, sources, stored bytes, calculations, decisions",
  ],
  [
    "trace_reverse",
    "read",
    "read",
    "Find every statement, value, dataset revision, report and delivery that uses a source",
  ],
  ["list_watches", "read", "read", "List a workspace's watches"],
  // Knowledge reads: served by the application from the `api` views and functions with the caller's own session
  [
    "search_knowledge",
    "read",
    "read",
    "Search the industry knowledge base and its evidence; hits carry an evidence signal and what to read next",
  ],
  ["get_claim", "read", "read", "Read one claim: status, admission, verdicts, probe cells, restatements and conflicts"],
  ["get_entity", "read", "read", "Read one entity's card (facts, relationships, events, sources) or a library dossier"],
  [
    "get_fact_evidence",
    "read",
    "read",
    "Read where an entity's current facts of one kind come from: claim, exact locator, capture and source",
  ],
  [
    "list_entity_changes",
    "read",
    "read",
    "List what was opened or closed for one entity between two knowledge sequences: facts, events, relationships",
  ],
  [
    "get_summary_evidence",
    "read",
    "read",
    "Read the passages a document summary rests on: nodes, chunks, locators and timecodes",
  ],
  ["get_source", "read", "read", "Read one source's latest assessments and the claims behind its track record"],
  [
    "list_due",
    "read",
    "read",
    "List what is due: attention policies, probe revalidation, releases needing review, optionally changes since",
  ],
];

function definitionFor([name, kind, scope, summary, exposure = "public"]: Row): OperationDefinition {
  const schemas: Readonly<Record<string, z.ZodType>> = payloadSchemas;
  return { name, kind, scope, exposure, summary, payload: schemas[name] ?? databaseValidatedPayload };
}

export const operationCatalog: ReadonlyMap<string, OperationDefinition> = new Map(
  rows.map((row) => [row[0], definitionFor(row)]),
);

export function findOperation(name: string, kind: OperationKind): OperationDefinition | undefined {
  const definition = operationCatalog.get(name);
  return definition?.kind === kind ? definition : undefined;
}

export function publicOperations(): OperationDefinition[] {
  return [...operationCatalog.values()].filter((definition) => definition.exposure === "public");
}
