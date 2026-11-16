/**
 * Result shapes of the knowledge reads. They are compact projections of the `api` views and functions of
 * `ai-engineer-db-contract`; field names follow the database columns.
 */

/** Operations the application serves from the knowledge read surface instead of `api.product_read`. */
export const knowledgeOperations = ["search_knowledge", "get_claim", "get_entity", "get_source", "list_due"] as const;
export type KnowledgeOperation = (typeof knowledgeOperations)[number];

export function isKnowledgeOperation(name: string): name is KnowledgeOperation {
  return (knowledgeOperations as readonly string[]).includes(name);
}

/** How well a search hit is supported: +1 supported or verified, +0.5 qualified, -1 contradicted or disputed. */
export interface EvidenceSignal {
  readonly signal: number;
  readonly verdict: string | null;
  readonly claims: number;
}

/** The operation and payload that read the record behind a hit. */
export interface ReadMore {
  readonly operation: KnowledgeOperation;
  readonly payload: Readonly<Record<string, string>>;
}

export interface KnowledgeHit {
  /** `<target kind>:<id>`, for example `claim:<uuid>`. */
  readonly ref: string;
  readonly kind: string;
  /** Derived from the first line of the matched text; the search function returns no title. */
  readonly title: string;
  readonly snippet: string;
  readonly score: number;
  readonly lens: string;
  readonly tier: number | null;
  readonly space: string;
  /** `null` when no claim has been judged for this hit. */
  readonly evidence: EvidenceSignal | null;
  readonly read_more: ReadMore | null;
  readonly entity_id?: string;
  readonly document_id?: string;
  readonly observed_at?: string;
}

export interface KnowledgeSearchResult {
  readonly query: string;
  readonly lenses: readonly string[];
  readonly hits: readonly KnowledgeHit[];
  /** Present when nothing matched: how to widen the search. */
  readonly note?: string;
}

export interface ClaimVerdict {
  readonly probe: string | null;
  readonly verdict: string | null;
  readonly review_state: string | null;
}

export interface ProbeCell {
  readonly cell: string;
  readonly outcome: string | null;
  readonly resolved: unknown;
  readonly started_at: string | null;
  /** Evidence locator of the run output. */
  readonly locator_id: string | null;
}

export interface ClaimView {
  readonly claim_id: string;
  readonly statement: string;
  readonly claim_type: string | null;
  readonly status: string;
  readonly path: string | null;
  readonly source_role: string | null;
  readonly subjects: readonly string[];
  readonly stated_by: string | null;
  readonly channel: string | null;
  readonly stated_at: string | null;
  readonly quote: string | null;
  readonly document: { readonly node_id: string; readonly title: string | null } | null;
  /** The admission behind a verified status; `null` for a claim that is not verified. */
  readonly verified: {
    readonly verified_at: string | null;
    readonly receipt_id: string;
    readonly use_decision_id: string | null;
    readonly executor_version: string | null;
  } | null;
  readonly verdicts: readonly ClaimVerdict[];
  readonly latest_verdict: {
    readonly probe: string | null;
    readonly verdict: string | null;
    readonly review_state: string | null;
    readonly decided_by: string | null;
    readonly decided_at: string | null;
    readonly rationale: string | null;
  } | null;
  readonly probes: readonly { readonly probe: string; readonly cells: readonly ProbeCell[] }[];
  readonly restatements: {
    readonly restated_as: readonly Readonly<Record<string, unknown>>[];
    readonly restates: Readonly<Record<string, unknown>> | null;
  };
  readonly conflicts: readonly Readonly<Record<string, unknown>>[];
}

export interface SourceView {
  readonly source: {
    readonly source_entity_id: string;
    readonly name: string | null;
    readonly kind: string | null;
    readonly platform?: string | null;
    readonly url?: string | null;
  };
  readonly assessments: readonly Readonly<Record<string, unknown>>[];
  readonly track_record: readonly Readonly<Record<string, unknown>>[];
  readonly track_record_truncated: boolean;
}

export interface DueList {
  readonly as_of: string | null;
  readonly attention: readonly Readonly<Record<string, unknown>>[];
  readonly probe_revalidation: readonly Readonly<Record<string, unknown>>[];
  readonly releases_needing_review: readonly Readonly<Record<string, unknown>>[];
  readonly changes?: readonly Readonly<Record<string, unknown>>[];
  readonly modules_affected?: readonly Readonly<Record<string, unknown>>[];
  /** Row counts before the per-list limit was applied. */
  readonly counts: Readonly<Record<string, number>>;
}
