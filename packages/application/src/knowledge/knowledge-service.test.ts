import {
  type ClaimView,
  type DueList,
  describeReference,
  type EntityChanges,
  type FactEvidence,
  type JsonObject,
  type KnowledgeSearchResult,
  knowledgeOperations,
  type OperationDescription,
  ProductError,
  type SourceView,
  type SummaryEvidence,
} from "@aiengineer/service-contracts";
import { describe, expect, it } from "vitest";
import type { CommandCall, DatabaseGateway, ReadCall } from "../database-gateway.js";
import { PostgrestDatabaseGateway, productErrorFromPostgrest } from "../database-gateway.js";
import type { ObjectStorage } from "../object-storage.js";
import { ProductService } from "../product-service.js";
import type { CallerSession } from "../session.js";
import { type KnowledgeDatabase, PostgrestKnowledgeDatabase, type RowQuery } from "./knowledge-database.js";
import { KnowledgeService } from "./knowledge-service.js";

const session = { accessToken: "user-token" };
const claimId = "0193e3c1-6f5a-7c3e-9a1b-2c3d4e5f6a7b";
const entityId = "0193e3c1-6f5a-7c3e-9a1b-2c3d4e5f6a7c";
const sourceId = "0193e3c1-6f5a-7c3e-9a1b-2c3d4e5f6a7d";

type Rows = Readonly<Record<string, unknown>>[];

/** Canned answers by function and view name; records every call so tests can assert what was (not) read. */
class FakeKnowledgeDatabase implements KnowledgeDatabase {
  readonly calls: { name: string; args: JsonObject }[] = [];
  readonly reads: { relation: string; query: RowQuery }[] = [];

  constructor(
    private readonly functions: Readonly<Record<string, unknown>> = {},
    private readonly views: Readonly<Record<string, Rows>> = {},
    knowledgeSequence = 42,
  ) {
    this.functions = { knowledge_head: [{ knowledge_seq: knowledgeSequence }], ...functions };
  }

  async call<T>(_session: unknown, name: string, args: JsonObject): Promise<T> {
    this.calls.push({ name, args });
    return (this.functions[name] ?? null) as T;
  }

  async rows<T>(_session: unknown, relation: string, query: RowQuery): Promise<T[]> {
    this.reads.push({ relation, query });
    return (this.views[relation] ?? []) as T[];
  }
}

const searchRow = {
  vector_item_id: "item-1",
  lens: "evidence",
  source_tier: 0,
  content_kind: "claim",
  entity_id: null,
  document_id: null,
  target_kind: "claim",
  target_id: claimId,
  snippet: "create_react_agent moved to langchain.agents.\n\nThe prebuilt import is deprecated in LangGraph 1.0.",
  observed_at: null,
  space_slug: "assertions",
  fused_score: 0.0327868,
  channel_scores: {
    fts: { score: 0.1, rank: 1 },
    evidence: { signal: 1, claims: 1, verdict: "directly_supported", weight: 0.15, factor: 1.15 },
  },
};

describe("search_knowledge", () => {
  it("returns compact hits with an evidence signal and what to read next", async () => {
    const entityRow = {
      ...searchRow,
      vector_item_id: "item-2",
      lens: "corpus",
      source_tier: 2,
      content_kind: "profile",
      entity_id: entityId,
      target_kind: "entity",
      target_id: entityId,
      snippet: "LangGraph: a library for stateful agents.",
      space_slug: "entity_cards",
      channel_scores: { fts: { score: 0.05, rank: 2 } },
    };
    const database = new FakeKnowledgeDatabase({ search_knowledge: [searchRow, entityRow] });
    const result = (await new KnowledgeService(database).read(session, "search_knowledge", {
      query: "create_react_agent",
    })) as KnowledgeSearchResult;

    expect(result.hits).toEqual([
      {
        ref: `claim:${claimId}`,
        kind: "claim",
        title: "create_react_agent moved to langchain.agents.",
        snippet: "create_react_agent moved to langchain.agents. The prebuilt import is deprecated in LangGraph 1.0.",
        score: 0.0328,
        lens: "evidence",
        tier: 0,
        space: "assertions",
        evidence: { signal: 1, verdict: "directly_supported", claims: 1 },
        read_more: { operation: "get_claim", payload: { claim_id: claimId } },
      },
      expect.objectContaining({
        ref: `entity:${entityId}`,
        evidence: null,
        read_more: { operation: "get_entity", payload: { entity_id: entityId } },
        entity_id: entityId,
      }),
    ]);
    expect(result.note).toBeUndefined();
  });

  it("searches only the corpus and evidence lenses, collapsed, and never forwards a workspace", async () => {
    const database = new FakeKnowledgeDatabase({ search_knowledge: [] });
    const result = (await new KnowledgeService(database).read(session, "search_knowledge", {
      query: "retries",
    })) as KnowledgeSearchResult;
    expect(database.calls).toEqual([
      {
        name: "search_knowledge",
        args: { p_query: "retries", p_lenses: ["corpus", "evidence"], p_limit: 10, p_collapse: true },
      },
    ]);
    expect(result).toMatchObject({ hits: [], lenses: ["corpus", "evidence"] });
    expect(result.note).toContain("keyword");
  });

  it("passes the filters the function supports and drops rows of any other lens", async () => {
    const database = new FakeKnowledgeDatabase({ search_knowledge: [searchRow, { ...searchRow, lens: "private" }] });
    const result = (await new KnowledgeService(database).read(session, "search_knowledge", {
      query: "retries",
      lenses: ["evidence"],
      tiers: [0],
      spaces: ["assertions"],
      kinds: ["claim"],
      as_of: "2026-11-01T00:00:00Z",
      limit: 3,
      collapse: false,
    })) as KnowledgeSearchResult;
    expect(database.calls[0]?.args).toEqual({
      p_query: "retries",
      p_lenses: ["evidence"],
      p_tiers: [0],
      p_space_slugs: ["assertions"],
      p_content_kinds: ["claim"],
      p_as_of: "2026-11-01T00:00:00Z",
      p_limit: 3,
      p_collapse: false,
    });
    expect(result.hits).toHaveLength(1);
  });
});

const claimViews = {
  claim_candidates: [
    {
      claim_id: claimId,
      claim_type: "behaviour",
      statement: "create_react_agent moved to langchain.agents.",
      status: "verified",
      path: "restatement",
      source_role: "third_party",
      subjects: ["LangGraph"],
      document_node_id: entityId,
      document_title: "Migration notes",
    },
  ],
  verified_claims: [
    {
      receipt_id: sourceId,
      use_decision_id: "use-1",
      verified_at: "2026-11-15T10:00:00Z",
      executor_version: "ks-1",
      verdicts: [{ probe: "react-agent-import", verdict: "directly_supported", review_state: "human_confirmed" }],
    },
  ],
  claim_verdicts: [
    {
      stated_at: "2026-10-20",
      quote: "The prebuilt import is deprecated.",
      stated_by: "A. Author",
      channel: "Example blog",
      verdict: "directly_supported",
      probe: "react-agent-import",
      review_state: "human_confirmed",
      decided_by: "probe-runner",
      decided_at: "2026-11-15T09:00:00Z",
      rationale: "Both cells import from langchain.agents.",
    },
  ],
  claim_restatements: [
    {
      claim_id: claimId,
      statement: "create_react_agent moved to langchain.agents.",
      status: "verified",
      qualified: false,
      dropped: null,
      probe: "react-agent-import",
      original_claim_id: entityId,
      original_statement: "The post states that create_react_agent moved.",
      original_status: "proposed",
    },
  ],
};

describe("get_claim", () => {
  it("composes status, admission, verdicts, probe cells and restatement links", async () => {
    const database = new FakeKnowledgeDatabase(
      {
        probe_matrix: [
          {
            cell_label: "latest",
            cell: {},
            outcome: "pass",
            resolved: { langgraph: "1.0.2" },
            observations: { large: "omitted from the answer" },
            started_at: "2026-11-15T08:00:00Z",
            run_id: "run-1",
            locator_id: "locator-1",
          },
        ],
      },
      claimViews,
    );
    const claim = (await new KnowledgeService(database).read(session, "get_claim", { claim_id: claimId })) as ClaimView;

    expect(claim).toMatchObject({
      claim_id: claimId,
      status: "verified",
      subjects: ["LangGraph"],
      stated_by: "A. Author",
      channel: "Example blog",
      document: { node_id: entityId, title: "Migration notes" },
      verified: { receipt_id: sourceId, use_decision_id: "use-1" },
      verdicts: [{ probe: "react-agent-import", verdict: "directly_supported", review_state: "human_confirmed" }],
      latest_verdict: { decided_by: "probe-runner" },
      probes: [
        {
          probe: "react-agent-import",
          cells: [{ cell: "latest", outcome: "pass", resolved: { langgraph: "1.0.2" }, locator_id: "locator-1" }],
        },
      ],
      restatements: { restated_as: [], restates: { claim_id: entityId, status: "proposed" } },
      conflicts: [],
    });
    expect(JSON.stringify(claim)).not.toContain("omitted from the answer");
    expect(database.reads.map((read) => read.relation)).toEqual([
      "claim_candidates",
      "verified_claims",
      "claim_verdicts",
      "claim_restatements",
      "claim_conflicts",
    ]);
    expect(database.reads[0]?.query.filters).toEqual({ claim_id: `eq.${claimId}` });
    expect(database.reads[3]?.query.either).toBe(`(claim_id.eq.${claimId},original_claim_id.eq.${claimId})`);
  });

  it("reports a claim that is not verified without an admission", async () => {
    const database = new FakeKnowledgeDatabase(
      {},
      { claim_candidates: [{ ...claimViews.claim_candidates[0], status: "proposed" }] },
    );
    const claim = (await new KnowledgeService(database).read(session, "get_claim", { claim_id: claimId })) as ClaimView;
    expect(claim).toMatchObject({ status: "proposed", verified: null, verdicts: [], latest_verdict: null, probes: [] });
  });

  it("reads the views first and asks for the knowledge head only when the claim is missing", async () => {
    const found = new FakeKnowledgeDatabase({}, claimViews);
    await new KnowledgeService(found).read(session, "get_claim", { claim_id: claimId });
    expect(found.calls.map((call) => call.name)).not.toContain("knowledge_head");

    const missing = new FakeKnowledgeDatabase();
    await expect(new KnowledgeService(missing).read(session, "get_claim", { claim_id: claimId })).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );
    expect(missing.calls.map((call) => call.name)).toEqual(["knowledge_head"]);
  });

  it("is NOT_AVAILABLE, not 'not found', when the session sees no sealed knowledge", async () => {
    const database = new FakeKnowledgeDatabase({}, {}, 0);
    await expect(
      new KnowledgeService(database).read(session, "get_claim", { claim_id: claimId }),
    ).rejects.toMatchObject({ code: "NOT_AVAILABLE", detail: expect.stringContaining("no sealed knowledge") });
  });
});

describe("get_entity", () => {
  it("reads a library dossier without needing the tenant context", async () => {
    const dossier = {
      library: { slug: "langgraph", name: "LangGraph" },
      releases: { count: 3 },
      claims: { total: 4, verified: 2 },
      probes: [{ probe: "react-agent-import", verdicts: Array.from({ length: 14 }, (_, index) => ({ claim: index })) }],
      sources: [],
    };
    const database = new FakeKnowledgeDatabase({ library_dossier: dossier }, {}, 0);
    const result = (await new KnowledgeService(database).read(session, "get_entity", { library: "langgraph" })) as {
      kind: string;
      probes: { verdicts: unknown[] }[];
    };
    expect(result.kind).toBe("library_dossier");
    expect(result.probes[0]?.verdicts).toHaveLength(10);
    expect(database.calls).toEqual([{ name: "library_dossier", args: { p_library: "langgraph" } }]);
  });

  it("reads an entity card and says what it left out", async () => {
    const card = {
      entity: { id: entityId, kind: "library", slug: "langgraph", display_name: "LangGraph", tenant_id: "t" },
      aliases: ["langgraph"],
      facts: Array.from({ length: 30 }, (_, index) => ({ stream_kind: "price", scope_key: `s${index}`, k_from: 1 })),
      relationships: [{ kind: "develops", from_entity_id: sourceId, to_entity_id: entityId, properties: {} }],
      events: [],
      sources: [],
    };
    const database = new FakeKnowledgeDatabase({ entity_card: card });
    const result = (await new KnowledgeService(database).read(session, "get_entity", { entity_id: entityId })) as {
      entity: Record<string, unknown>;
      facts: Record<string, unknown>[];
      truncated: Record<string, number>;
    };
    expect(result.entity).toMatchObject({ id: entityId, display_name: "LangGraph" });
    expect(result.entity).not.toHaveProperty("tenant_id");
    expect(result.facts).toHaveLength(25);
    expect(result.facts[0]).not.toHaveProperty("k_from");
    expect(result.truncated).toEqual({ facts: 5 });
    expect(database.calls.map((call) => call.name)).toEqual(["entity_card"]);
  });

  it("is NOT_FOUND for an unknown library or entity", async () => {
    const service = new KnowledgeService(new FakeKnowledgeDatabase({ library_dossier: { library: null } }));
    await expect(service.read(session, "get_entity", { library: "nope" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.read(session, "get_entity", { entity_id: entityId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("is NOT_AVAILABLE for an entity card when the session sees no sealed knowledge", async () => {
    const service = new KnowledgeService(new FakeKnowledgeDatabase({}, {}, 0));
    await expect(service.read(session, "get_entity", { entity_id: entityId })).rejects.toMatchObject({
      code: "NOT_AVAILABLE",
    });
  });
});

describe("get_fact_evidence", () => {
  const locatorRow = {
    segment_id: "segment-1",
    scope_key: "input_tokens|standard|short|",
    amount: 2.5,
    currency: "USD",
    unit: "USD_per_1M_tokens",
    status: null,
    payload: { meter: "input_tokens" },
    valid_during: '["2026-11-06 02:36:11+00",)',
    claim_id: claimId,
    claim_statement: "The model costs USD 2.5 per 1M input tokens as stated by the vendor on 2026-11-06",
    locator_id: "locator-1",
    selector_kind: "table",
    selector: { table: 9, row: 2, column: 1, cell: "$2.50" },
    normalized_value: "model: Short context input = $2.50",
    capture_id: "capture-1",
    captured_at: "2026-11-06T02:36:11+00:00",
    request_url: "https://example.test/pricing.md",
    source_url: "https://example.test/pricing.md",
    document_node_id: "node-1",
    unit_kind: "price_row",
    logical_key: "price_row:model|input_tokens",
  };

  it("returns each fact with its claim, exact locator, capture and document unit", async () => {
    const database = new FakeKnowledgeDatabase({
      fact_locators: [locatorRow, { ...locatorRow, segment_id: "segment-2", claim_id: null, locator_id: null }],
    });
    const evidence = (await new KnowledgeService(database).read(session, "get_fact_evidence", {
      entity_id: entityId,
      stream_kind: "offering_price",
      scope_key: "input_tokens|standard|short|",
      limit: 1,
    })) as FactEvidence;
    expect(database.calls).toEqual([
      {
        name: "fact_locators",
        args: { p_entity: entityId, p_stream_kind: "offering_price", p_scope_key: "input_tokens|standard|short|" },
      },
    ]);
    expect(evidence).toMatchObject({ entity_id: entityId, stream_kind: "offering_price", count: 2, truncated: true });
    expect(evidence.facts).toEqual([
      {
        segment_id: "segment-1",
        scope_key: "input_tokens|standard|short|",
        amount: 2.5,
        currency: "USD",
        unit: "USD_per_1M_tokens",
        status: null,
        valid_during: '["2026-11-06 02:36:11+00",)',
        payload: { meter: "input_tokens" },
        claim: { claim_id: claimId, statement: locatorRow.claim_statement },
        locator: {
          locator_id: "locator-1",
          selector_kind: "table",
          selector: { table: 9, row: 2, column: 1, cell: "$2.50" },
          normalized_value: "model: Short context input = $2.50",
        },
        capture: {
          capture_id: "capture-1",
          captured_at: "2026-11-06T02:36:11+00:00",
          request_url: "https://example.test/pricing.md",
          source_url: "https://example.test/pricing.md",
        },
        unit_ref: { document_node_id: "node-1", unit_kind: "price_row", logical_key: "price_row:model|input_tokens" },
      },
    ]);
  });

  it("keeps a fact that has no claim or locator yet, and says so with nulls", async () => {
    const database = new FakeKnowledgeDatabase({
      fact_locators: [{ ...locatorRow, claim_id: null, locator_id: null, capture_id: null, document_node_id: null }],
    });
    const evidence = (await new KnowledgeService(database).read(session, "get_fact_evidence", {
      entity_id: entityId,
      stream_kind: "offering_price",
    })) as FactEvidence;
    expect(evidence.facts[0]).toMatchObject({ claim: null, locator: null, capture: null, unit_ref: null });
    expect(evidence.truncated).toBe(false);
  });

  it("is NOT_FOUND without such facts, and NOT_AVAILABLE when the session sees no sealed knowledge", async () => {
    const payload = { entity_id: entityId, stream_kind: "offering_price" };
    await expect(
      new KnowledgeService(new FakeKnowledgeDatabase({ fact_locators: [] })).read(
        session,
        "get_fact_evidence",
        payload,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      new KnowledgeService(new FakeKnowledgeDatabase({}, {}, 0)).read(session, "get_fact_evidence", payload),
    ).rejects.toMatchObject({ code: "NOT_AVAILABLE" });
  });
});

describe("list_entity_changes", () => {
  const changed = [
    {
      change_kind: "opened",
      item_kind: "relationship",
      item_id: "rel-1",
      knowledge_seq: 12,
      details: { kind: "version_of", from_entity_id: sourceId, to_entity_id: entityId, qualifier: "", properties: {} },
    },
    {
      change_kind: "opened",
      item_kind: "segment",
      item_id: "segment-1",
      knowledge_seq: 40,
      details: {
        stream_id: "stream-1",
        amount: 2.5,
        currency: "USD",
        unit: "USD_per_1M_tokens",
        belief: "accepted",
        tenant_id: "t",
        primary_claim_id: claimId,
        payload: { meter: "input_tokens" },
      },
    },
    { change_kind: "closed", item_kind: "segment", item_id: "segment-0", knowledge_seq: 40, details: { amount: 3 } },
  ];

  it("lists changes up to the knowledge head, newest first, and returns the sequence it reached", async () => {
    const database = new FakeKnowledgeDatabase({ what_changed: changed });
    const changes = (await new KnowledgeService(database).read(session, "list_entity_changes", {
      entity_id: entityId,
      limit: 2,
    })) as EntityChanges;
    expect(database.calls).toEqual([
      { name: "knowledge_head", args: {} },
      { name: "what_changed", args: { p_entity: entityId, p_k1: 0, p_k2: 42 } },
    ]);
    expect(changes).toMatchObject({
      entity_id: entityId,
      after_seq: 0,
      through_seq: 42,
      counts: { "opened relationship": 1, "opened segment": 1, "closed segment": 1 },
      truncated: true,
    });
    expect(changes.changes.map((change) => change.knowledge_seq)).toEqual([40, 40]);
    expect(changes.changes[0]).toEqual({
      change_kind: "opened",
      item_kind: "segment",
      item_id: "segment-1",
      knowledge_seq: 40,
      details: {
        stream_id: "stream-1",
        amount: 2.5,
        currency: "USD",
        unit: "USD_per_1M_tokens",
        status: null,
        valid_during: null,
        belief: "accepted",
        ref_entity_id: null,
        claim_id: claimId,
        payload: { meter: "input_tokens" },
      },
    });
  });

  it("reads an explicit range without asking for the head, and an unchanged range is an answer", async () => {
    const database = new FakeKnowledgeDatabase({ what_changed: [] });
    const changes = (await new KnowledgeService(database).read(session, "list_entity_changes", {
      entity_id: entityId,
      after_seq: 40,
      through_seq: 42,
    })) as EntityChanges;
    expect(database.calls[0]).toEqual({ name: "what_changed", args: { p_entity: entityId, p_k1: 40, p_k2: 42 } });
    expect(changes).toMatchObject({ after_seq: 40, through_seq: 42, changes: [], counts: {}, truncated: false });
  });

  it("refuses a range that ends before it starts, and is NOT_AVAILABLE when the session sees no sealed knowledge", async () => {
    await expect(
      new KnowledgeService(new FakeKnowledgeDatabase()).read(session, "list_entity_changes", {
        entity_id: entityId,
        after_seq: 50,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    for (const payload of [{ entity_id: entityId }, { entity_id: entityId, after_seq: 1, through_seq: 5 }]) {
      await expect(
        new KnowledgeService(new FakeKnowledgeDatabase({}, {}, 0)).read(session, "list_entity_changes", payload),
      ).rejects.toMatchObject({ code: "NOT_AVAILABLE" });
    }
  });
});

describe("get_summary_evidence", () => {
  it("returns the passages a summary rests on", async () => {
    const database = new FakeKnowledgeDatabase({
      summary_evidence: [
        { node_id: "node-1", chunk_id: "chunk-1", locator_id: "locator-1", start_ms: 1000, end_ms: 9000, extra: "x" },
        { node_id: "node-2", chunk_id: null, locator_id: null, start_ms: null, end_ms: null },
      ],
    });
    const evidence = (await new KnowledgeService(database).read(session, "get_summary_evidence", {
      summary_id: entityId,
      limit: 1,
    })) as SummaryEvidence;
    expect(database.calls).toEqual([{ name: "summary_evidence", args: { p_summary: entityId } }]);
    expect(evidence).toEqual({
      summary_id: entityId,
      sources: [{ node_id: "node-1", chunk_id: "chunk-1", locator_id: "locator-1", start_ms: 1000, end_ms: 9000 }],
      count: 2,
      truncated: true,
    });
  });

  it("is NOT_FOUND for a summary without recorded sources", async () => {
    await expect(
      new KnowledgeService(new FakeKnowledgeDatabase()).read(session, "get_summary_evidence", { summary_id: entityId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("get_source", () => {
  const registry = {
    source_entity_id: sourceId,
    source_kind: "person",
    source: "A. Author",
    platform: "blog",
    url: "https://example.test/a",
    topic: "LangGraph",
    as_of: "2026-11-14T00:00:00Z",
    claims_checked: 5,
    confirmed: 4,
    refuted: 1,
    authority_score: 0.8,
    rationale: "Four of five checked claims confirmed.",
  };
  const stated = { source_entity_id: sourceId, source: "A. Author", source_kind: "person", claim_id: claimId };

  it("returns the latest assessments and the claims behind them, looked up by name", async () => {
    const database = new FakeKnowledgeDatabase(
      {},
      {
        source_registry: [registry],
        source_track_record: [{ ...stated, statement: "s", verdict: "directly_supported" }],
      },
    );
    const source = (await new KnowledgeService(database).read(session, "get_source", {
      name: "a. author",
    })) as SourceView;
    expect(source).toMatchObject({
      source: { source_entity_id: sourceId, name: "A. Author", kind: "person", platform: "blog" },
      assessments: [{ topic: "LangGraph", claims_checked: 5, confirmed: 4, refuted: 1, authority_score: 0.8 }],
      track_record: [{ claim_id: claimId, verdict: "directly_supported" }],
      track_record_truncated: false,
    });
    expect(database.reads[0]?.query.filters).toEqual({ source: "ilike.a. author" });
    expect(database.reads[1]?.query.filters).toEqual({ source_entity_id: `eq.${sourceId}` });
    expect(database.calls).toEqual([]);
  });

  it("returns a track record for a source that has no assessment yet", async () => {
    const database = new FakeKnowledgeDatabase({}, { source_track_record: [stated] });
    const source = (await new KnowledgeService(database).read(session, "get_source", {
      source_entity_id: sourceId,
    })) as SourceView;
    expect(source).toMatchObject({ source: { name: "A. Author" }, assessments: [], track_record: [{}] });
  });

  it("is NOT_FOUND for an unknown source", async () => {
    await expect(
      new KnowledgeService(new FakeKnowledgeDatabase()).read(session, "get_source", { source_entity_id: sourceId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("list_due", () => {
  const functions = {
    attention_due: [{ policy_id: "p1", slug: "langgraph-releases", watch_level: "W2", reason: "cadence P7D" }],
    probe_revalidation_due: [],
    releases_needing_review: [
      {
        release_id: "r1",
        release_no: 2,
        claim_id: claimId,
        verdict_at_release: "directly_supported",
        verdict_now: "contradicted",
      },
    ],
    changes_since: [{ change_kind: "fact_opened", subject: "LangGraph", new_value: { version: "1.0.2" } }],
    modules_affected_by_release: [{ work_slug: "reliable-tool-calls", breaking: true }],
  };

  it("lists the three due lists, and an empty list is an answer", async () => {
    const database = new FakeKnowledgeDatabase(functions);
    const due = (await new KnowledgeService(database).read(session, "list_due", {})) as DueList;
    expect(due).toMatchObject({
      as_of: null,
      attention: [{ slug: "langgraph-releases", watch_level: "W2" }],
      probe_revalidation: [],
      releases_needing_review: [{ release_no: 2, verdict_now: "contradicted" }],
      counts: { attention: 1, probe_revalidation: 0, releases_needing_review: 1 },
    });
    expect(due).not.toHaveProperty("changes");
    expect(database.calls.map((call) => call.name)).toEqual([
      "attention_due",
      "probe_revalidation_due",
      "releases_needing_review",
    ]);
  });

  it("adds changes since a time and the modules a release affects", async () => {
    const database = new FakeKnowledgeDatabase(functions);
    const due = (await new KnowledgeService(database).read(session, "list_due", {
      as_of: "2026-11-15T00:00:00Z",
      since: "2026-11-01T00:00:00Z",
      release_id: entityId,
      limit: 5,
    })) as DueList;
    expect(due.changes).toEqual([expect.objectContaining({ subject: "LangGraph", new_value: { version: "1.0.2" } })]);
    expect(due.modules_affected).toEqual([
      expect.objectContaining({ work_slug: "reliable-tool-calls", breaking: true }),
    ]);
    expect(database.calls).toEqual(
      expect.arrayContaining([
        { name: "attention_due", args: { p_as_of: "2026-11-15T00:00:00Z" } },
        { name: "changes_since", args: { p_since: "2026-11-01T00:00:00Z" } },
        { name: "modules_affected_by_release", args: { p_release: entityId } },
      ]),
    );
  });

  it("answers 'nothing due' only when the session sees the knowledge base", async () => {
    const nothing = { attention_due: [], probe_revalidation_due: [], releases_needing_review: [] };
    const due = (await new KnowledgeService(new FakeKnowledgeDatabase(nothing)).read(
      session,
      "list_due",
      {},
    )) as DueList;
    expect(due.counts).toEqual({ attention: 0, probe_revalidation: 0, releases_needing_review: 0 });

    const blind = new FakeKnowledgeDatabase(nothing, {}, 0);
    await expect(new KnowledgeService(blind).read(session, "list_due", {})).rejects.toMatchObject({
      code: "NOT_AVAILABLE",
      detail: expect.stringContaining("no sealed knowledge"),
    });
    expect(blind.calls.map((call) => call.name)).toContain("knowledge_head");
  });
});

const config = {
  databaseUrl: "http://db.test",
  databasePublishableKey: "publishable",
  databaseSecretKey: "secret",
  databaseReleaseCheck: "enforce",
} as const;

class RefusingGateway implements DatabaseGateway {
  readonly reads: ReadCall[] = [];
  readonly scopes: { clientToken: string | undefined; scope: string }[] = [];
  constructor(private readonly scopeError?: ProductError) {}
  async command(_session: unknown, _call: CommandCall): Promise<JsonObject> {
    return {};
  }
  async read(_session: unknown, call: ReadCall): Promise<unknown> {
    this.reads.push(call);
    return { ok: true };
  }
  async scope(caller: CallerSession, scope: string): Promise<JsonObject> {
    this.scopes.push({ clientToken: caller.clientToken, scope });
    if (this.scopeError) throw this.scopeError;
    return { principalId: "user", clientGrantId: "grant-1", clientKind: "mcp" };
  }
  async worker(): Promise<JsonObject> {
    return {};
  }
  async databaseRelease(): Promise<unknown> {
    return null;
  }
}
const storage: ObjectStorage = { put: async () => undefined, get: async () => new Uint8Array() };

describe("ProductService knowledge routing", () => {
  it("serves knowledge reads from the knowledge reader, never from api.product_read", async () => {
    const gateway = new RefusingGateway();
    const knowledge = new FakeKnowledgeDatabase({ search_knowledge: [searchRow] });
    const service = new ProductService(gateway, storage, new KnowledgeService(knowledge));
    const result = (await service.runRead(session, "search_knowledge", {
      payload: { query: "retries" },
    })) as KnowledgeSearchResult;
    expect(result.hits).toHaveLength(1);
    expect(gateway.reads).toEqual([]);
    await service.runRead(session, "search", { payload: { query: "retries" } });
    expect(gateway.reads.map((call) => call.operation)).toEqual(["search"]);
  });

  it("validates knowledge payloads at the edge before any database call", async () => {
    const knowledge = new FakeKnowledgeDatabase();
    const service = new ProductService(new RefusingGateway(), storage, new KnowledgeService(knowledge));
    await expect(
      service.runRead(session, "search_knowledge", { payload: { query: "x", lenses: ["private"] } }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(service.runRead(session, "get_claim", { payload: { claim_id: "42" } })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    expect(knowledge.calls).toEqual([]);
  });

  it("asks the database for the read scope when the request carries a client token, and only then", async () => {
    const gateway = new RefusingGateway();
    const knowledge = new FakeKnowledgeDatabase({ search_knowledge: [searchRow] });
    const service = new ProductService(gateway, storage, new KnowledgeService(knowledge));
    await service.runRead(session, "search_knowledge", { payload: { query: "retries" } });
    expect(gateway.scopes).toEqual([]);

    const client = { ...session, clientToken: "aiec_client" };
    for (const operation of knowledgeOperations) {
      const payload = describeReference(operation) as OperationDescription;
      await service.runRead(client, operation, { payload: payload.example.payload ?? {} }).catch(() => undefined);
    }
    expect(gateway.scopes).toEqual(knowledgeOperations.map(() => ({ clientToken: "aiec_client", scope: "read" })));
  });

  it("refuses a knowledge read when the client grant lacks the scope, before reading anything", async () => {
    const gateway = new RefusingGateway(new ProductError("CLIENT_SCOPE_DENIED", "read"));
    const knowledge = new FakeKnowledgeDatabase({ search_knowledge: [searchRow] }, claimViews);
    const service = new ProductService(gateway, storage, new KnowledgeService(knowledge));
    const client = { ...session, clientToken: "aiec_learn_only" };
    await expect(service.runRead(client, "get_claim", { payload: { claim_id: claimId } })).rejects.toMatchObject({
      code: "CLIENT_SCOPE_DENIED",
    });
    await expect(service.runRead(client, "list_due", { payload: {} })).rejects.toMatchObject({
      code: "CLIENT_SCOPE_DENIED",
    });
    expect(knowledge.calls).toEqual([]);
    expect(knowledge.reads).toEqual([]);
  });

  it("answers NOT_AVAILABLE when the deployment has no knowledge reader", async () => {
    const service = new ProductService(new RefusingGateway(), storage);
    await expect(service.runRead(session, "list_due", { payload: {} })).rejects.toMatchObject({
      code: "NOT_AVAILABLE",
    });
  });
});

describe("PostgrestKnowledgeDatabase", () => {
  function recordingFetch(body: unknown, status = 200) {
    const seen: { url?: string; method?: string; headers?: Record<string, string>; body?: unknown } = {};
    const fetchImpl = (async (
      url: string,
      init: { method: string; headers: Record<string, string>; body?: string },
    ) => {
      seen.url = url;
      seen.method = init.method;
      seen.headers = init.headers;
      seen.body = init.body ? JSON.parse(init.body) : undefined;
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
    return { seen, fetchImpl };
  }

  it("calls api functions as the caller, never with the service key", async () => {
    const { seen, fetchImpl } = recordingFetch([]);
    await new PostgrestKnowledgeDatabase(config, fetchImpl).call(session, "search_knowledge", { p_query: "x" });
    expect(seen).toMatchObject({
      url: "http://db.test/rest/v1/rpc/search_knowledge",
      method: "POST",
      body: { p_query: "x" },
      headers: { apikey: "publishable", authorization: "Bearer user-token", "content-profile": "api" },
    });
    expect(JSON.stringify(seen.headers)).not.toContain("secret");
  });

  it("asks api.product_scope as the caller, with the client token the request carried", async () => {
    const { seen, fetchImpl } = recordingFetch({ principalId: "user", clientGrantId: "grant-1" });
    const client = { ...session, clientToken: "aiec_client" };
    await new PostgrestDatabaseGateway(config, fetchImpl).scope(client, "read");
    expect(seen).toMatchObject({
      url: "http://db.test/rest/v1/rpc/product_scope",
      method: "POST",
      body: { p_scope: "read" },
      headers: { apikey: "publishable", authorization: "Bearer user-token", "x-aieng-client-token": "aiec_client" },
    });
    const denied = recordingFetch({ code: "P0001", message: "CLIENT_SCOPE_DENIED", details: "read" }, 400);
    await expect(new PostgrestDatabaseGateway(config, denied.fetchImpl).scope(client, "read")).rejects.toMatchObject({
      code: "CLIENT_SCOPE_DENIED",
    });
  });

  it("asks api.database_release with the service key: the startup read has no caller", async () => {
    const answer = { format: "ai-engineer-database-release/1", release: "1.5.0", state: "current" };
    const { seen, fetchImpl } = recordingFetch(answer);
    await expect(new PostgrestDatabaseGateway(config, fetchImpl).databaseRelease()).resolves.toEqual(answer);
    expect(seen).toMatchObject({
      url: "http://db.test/rest/v1/rpc/database_release",
      method: "POST",
      body: {},
      headers: { apikey: "secret", authorization: "Bearer secret", "content-profile": "api" },
    });
    const missing = recordingFetch({ code: "PGRST202", message: "Could not find the function" }, 404);
    await expect(new PostgrestDatabaseGateway(config, missing.fetchImpl).databaseRelease()).rejects.toMatchObject({
      code: "NOT_AVAILABLE",
    });
    const keyless = recordingFetch(answer);
    const withoutKey = new PostgrestDatabaseGateway({ ...config, databaseSecretKey: "" }, keyless.fetchImpl);
    await expect(withoutKey.databaseRelease()).rejects.toMatchObject({ code: "NOT_AVAILABLE" });
    expect(keyless.seen.url).toBeUndefined();
    // The read carries a time limit, so a database that never answers cannot hold a start forever.
    let signal: unknown;
    const timed = (async (_url: string, init: { signal?: AbortSignal }) => {
      signal = init.signal;
      return new Response(JSON.stringify(answer));
    }) as unknown as typeof fetch;
    await new PostgrestDatabaseGateway(config, timed).databaseRelease();
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("reads api views with PostgREST filters", async () => {
    const { seen, fetchImpl } = recordingFetch([]);
    await new PostgrestKnowledgeDatabase(config, fetchImpl).rows(session, "claim_restatements", {
      columns: ["claim_id", "statement"],
      either: `(claim_id.eq.${claimId},original_claim_id.eq.${claimId})`,
      order: "created_at.desc",
      limit: 20,
    });
    const url = new URL(seen.url ?? "");
    expect(url.pathname).toBe("/rest/v1/claim_restatements");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      select: "claim_id,statement",
      or: `(claim_id.eq.${claimId},original_claim_id.eq.${claimId})`,
      order: "created_at.desc",
      limit: "20",
    });
    expect(seen.headers).toMatchObject({ "accept-profile": "api", authorization: "Bearer user-token" });
  });

  it("reports a function or view the database does not have as NOT_AVAILABLE", async () => {
    const { fetchImpl } = recordingFetch({ code: "PGRST202", message: "Could not find the function" }, 404);
    await expect(
      new PostgrestKnowledgeDatabase(config, fetchImpl).call(session, "search_knowledge", { p_query: "x" }),
    ).rejects.toMatchObject({ code: "NOT_AVAILABLE" });
    expect(productErrorFromPostgrest(404, { code: "PGRST205", message: "no relation" }).code).toBe("NOT_AVAILABLE");
    expect(productErrorFromPostgrest(403, { code: "42501", message: "permission denied" }).code).toBe("FORBIDDEN");
  });
});
