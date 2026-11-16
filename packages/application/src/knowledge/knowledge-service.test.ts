import type { ClaimView, DueList, JsonObject, KnowledgeSearchResult, SourceView } from "@aiengineer/service-contracts";
import { describe, expect, it } from "vitest";
import type { CommandCall, DatabaseGateway, ReadCall } from "../database-gateway.js";
import { productErrorFromPostgrest } from "../database-gateway.js";
import type { ObjectStorage } from "../object-storage.js";
import { ProductService } from "../product-service.js";
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
    const database = new FakeKnowledgeDatabase({ search_unified: [searchRow, entityRow] });
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
    const database = new FakeKnowledgeDatabase({ search_unified: [] });
    const result = (await new KnowledgeService(database).read(session, "search_knowledge", {
      query: "retries",
    })) as KnowledgeSearchResult;
    expect(database.calls).toEqual([
      {
        name: "search_unified",
        args: { p_query: "retries", p_lenses: ["corpus", "evidence"], p_limit: 10, p_collapse: true },
      },
    ]);
    expect(result).toMatchObject({ hits: [], lenses: ["corpus", "evidence"] });
    expect(result.note).toContain("keyword");
  });

  it("passes the filters the function supports and drops rows of any other lens", async () => {
    const database = new FakeKnowledgeDatabase({ search_unified: [searchRow, { ...searchRow, lens: "private" }] });
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

  it("is NOT_FOUND for an unknown claim", async () => {
    await expect(
      new KnowledgeService(new FakeKnowledgeDatabase()).read(session, "get_claim", { claim_id: claimId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("is NOT_AVAILABLE, not empty, when the session has no knowledge tenant context", async () => {
    const database = new FakeKnowledgeDatabase({}, claimViews, 0);
    await expect(
      new KnowledgeService(database).read(session, "get_claim", { claim_id: claimId }),
    ).rejects.toMatchObject({ code: "NOT_AVAILABLE", detail: expect.stringContaining("tenant context") });
    expect(database.reads).toEqual([]);
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
    expect(database.calls.map((call) => call.name)).toEqual(["knowledge_head", "entity_card"]);
  });

  it("is NOT_FOUND for an unknown library or entity", async () => {
    const service = new KnowledgeService(new FakeKnowledgeDatabase({ library_dossier: { library: null } }));
    await expect(service.read(session, "get_entity", { library: "nope" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.read(session, "get_entity", { entity_id: entityId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
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
      "knowledge_head",
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

  it("is NOT_AVAILABLE rather than 'nothing due' without the knowledge tenant context", async () => {
    const database = new FakeKnowledgeDatabase(functions, {}, 0);
    await expect(new KnowledgeService(database).read(session, "list_due", {})).rejects.toMatchObject({
      code: "NOT_AVAILABLE",
    });
    expect(database.calls.map((call) => call.name)).toEqual(["knowledge_head"]);
  });
});

class RefusingGateway implements DatabaseGateway {
  readonly reads: ReadCall[] = [];
  async command(_session: unknown, _call: CommandCall): Promise<JsonObject> {
    return {};
  }
  async read(_session: unknown, call: ReadCall): Promise<unknown> {
    this.reads.push(call);
    return { ok: true };
  }
  async worker(): Promise<JsonObject> {
    return {};
  }
}
const storage: ObjectStorage = { put: async () => undefined, get: async () => new Uint8Array() };

describe("ProductService knowledge routing", () => {
  it("serves knowledge reads from the knowledge reader, never from api.product_read", async () => {
    const gateway = new RefusingGateway();
    const knowledge = new FakeKnowledgeDatabase({ search_unified: [searchRow] });
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

  it("answers NOT_AVAILABLE when the deployment has no knowledge reader", async () => {
    const service = new ProductService(new RefusingGateway(), storage);
    await expect(service.runRead(session, "list_due", { payload: {} })).rejects.toMatchObject({
      code: "NOT_AVAILABLE",
    });
  });
});

describe("PostgrestKnowledgeDatabase", () => {
  const config = { databaseUrl: "http://db.test", databasePublishableKey: "publishable", databaseSecretKey: "secret" };

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
    await new PostgrestKnowledgeDatabase(config, fetchImpl).call(session, "search_unified", { p_query: "x" });
    expect(seen).toMatchObject({
      url: "http://db.test/rest/v1/rpc/search_unified",
      method: "POST",
      body: { p_query: "x" },
      headers: { apikey: "publishable", authorization: "Bearer user-token", "content-profile": "api" },
    });
    expect(JSON.stringify(seen.headers)).not.toContain("secret");
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
      new PostgrestKnowledgeDatabase(config, fetchImpl).call(session, "search_unified", { p_query: "x" }),
    ).rejects.toMatchObject({ code: "NOT_AVAILABLE" });
    expect(productErrorFromPostgrest(404, { code: "PGRST205", message: "no relation" }).code).toBe("NOT_AVAILABLE");
    expect(productErrorFromPostgrest(403, { code: "42501", message: "permission denied" }).code).toBe("FORBIDDEN");
  });
});
