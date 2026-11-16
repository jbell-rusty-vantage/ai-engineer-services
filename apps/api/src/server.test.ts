import type {
  CommandCall,
  DatabaseGateway,
  KnowledgeReader,
  ObjectStorage,
  ReadCall,
} from "@aiengineer/service-application";
import { ProductService } from "@aiengineer/service-application";
import {
  type JsonObject,
  knowledgeOperations,
  ProductError,
  renderGuide,
  type SchemaPort,
} from "@aiengineer/service-contracts";
import { describe, expect, it } from "vitest";
import { buildApiServer } from "./server.js";

class EchoDatabase implements DatabaseGateway {
  last?: CommandCall | ReadCall;
  async command(_session: unknown, call: CommandCall): Promise<JsonObject> {
    this.last = call;
    if (call.payload.title === "forbidden") throw new ProductError("FORBIDDEN", "role reader");
    return { threadId: "t1", replayed: false };
  }
  async read(_session: unknown, call: ReadCall): Promise<unknown> {
    this.last = call;
    return [];
  }
  readonly scopes: { clientToken: string | undefined; scope: string }[] = [];
  async scope(session: { clientToken?: string }, scope: string): Promise<JsonObject> {
    this.scopes.push({ clientToken: session.clientToken, scope });
    if (session.clientToken === "aiec_learn_only") throw new ProductError("CLIENT_SCOPE_DENIED", scope);
    return { principalId: "user", clientGrantId: "grant-1", clientKind: "mcp" };
  }
  async worker(): Promise<JsonObject> {
    return { state: "available" };
  }
}

const storage: ObjectStorage = { put: async () => undefined, get: async () => new Uint8Array() };

function api(database = new EchoDatabase()) {
  return { database, app: buildApiServer({ service: new ProductService(database, storage) }) };
}

const head = { migration_head: "20261115120100", contract_version: "0.6.0", fingerprint: "sha256:fixture" };

/** Records what the routes ask the schema port for. */
class RecordingSchema implements SchemaPort {
  readonly asked: unknown[] = [];
  async searchSchema(query: string, options?: { limit?: number; kind?: string }) {
    this.asked.push({ query, options });
    return { head, query, total: 0, results: [], next: "Four reads at most" };
  }
  async getSchemaPage(page?: string) {
    this.asked.push({ page });
    return { head, page: page ?? "START_HERE.md", bytes: 12, truncated: false, text: "# Start here" };
  }
}

const command = { workspaceId: null, idempotencyKey: "key-12345", payload: { title: "Retry help", purpose: "tutor" } };

describe("API server", () => {
  it("publishes the public operation catalog", async () => {
    const response = await api().app.inject({ method: "GET", url: "/v1/operations" });
    const names = response.json().operations.map((operation: { name: string }) => operation.name);
    expect(names).toContain("search");
    expect(names).not.toContain("register_asset");
  });

  it("requires a bearer token", async () => {
    const response = await api().app.inject({ method: "POST", url: "/v1/commands/create_thread", payload: command });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("AUTH_REQUIRED");
  });

  it("runs a command as the caller", async () => {
    const { app, database } = api();
    const response = await app.inject({
      method: "POST",
      url: "/v1/commands/create_thread",
      headers: { authorization: "Bearer user" },
      payload: command,
    });
    expect(response.statusCode).toBe(200);
    expect(database.last?.operation).toBe("create_thread");
  });

  it("maps database errors to HTTP statuses", async () => {
    const response = await api().app.inject({
      method: "POST",
      url: "/v1/commands/create_thread",
      headers: { authorization: "Bearer user" },
      payload: { ...command, payload: { title: "forbidden", purpose: "tutor" } },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ code: "FORBIDDEN", message: "FORBIDDEN", detail: "role reader" });
  });

  it("rejects unknown operations and malformed bodies", async () => {
    const headers = { authorization: "Bearer user" };
    expect(
      (await api().app.inject({ method: "POST", url: "/v1/commands/register_asset", headers, payload: command }))
        .statusCode,
    ).toBe(404);
    expect(
      (await api().app.inject({ method: "POST", url: "/v1/reads/search", headers, payload: { payload: {} } }))
        .statusCode,
    ).toBe(422);
  });

  it("requires asset metadata for uploads", async () => {
    const response = await api().app.inject({
      method: "POST",
      url: "/v1/assets",
      headers: { authorization: "Bearer user", "content-type": "application/octet-stream" },
      payload: Buffer.from("bytes"),
    });
    expect(response.statusCode).toBe(422);
  });
});

describe("reference routes", () => {
  it("serves the guide start page and topics without a session", async () => {
    const { app } = api();
    const index = (await app.inject({ method: "GET", url: "/v1/guide" })).json();
    expect(index.topic).toBe("index");
    expect(index.text).toContain("search_knowledge");
    expect(index.topics).toContain("authoring");
    const authoring = await app.inject({ method: "GET", url: "/v1/guide/authoring" });
    expect(authoring.json().text).toContain("freeze_release");
    const unknown = await app.inject({ method: "GET", url: "/v1/guide/cooking" });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().code).toBe("NOT_FOUND");
  });

  it("serves a skill and one of its references as guide topics", async () => {
    const { app } = api();
    const index = (await app.inject({ method: "GET", url: "/v1/guide" })).json();
    expect(index.topics).toEqual(expect.arrayContaining(["content-authoring", "ai-engineer-knowledge-charter"]));
    expect(index.text).toContain("- content-authoring: ");
    const skill = await app.inject({ method: "GET", url: "/v1/guide/content-authoring" });
    expect(skill.statusCode).toBe(200);
    expect(skill.json()).toMatchObject({ topic: "content-authoring", title: "Content authoring" });
    expect(skill.json().text).toBe(renderGuide("content-authoring").text);
    const reference = await app.inject({ method: "GET", url: "/v1/guide/content-authoring/references/lesson-craft" });
    expect(reference.json().topic).toBe("content-authoring/references/lesson-craft");
    expect(reference.json().text.startsWith("# Lesson craft")).toBe(true);
    const withFileName = await app.inject({
      method: "GET",
      url: "/v1/guide/content-authoring/references/structure.md",
    });
    expect(withFileName.json().topic).toBe("content-authoring/references/structure");
    const sources = await app.inject({ method: "GET", url: "/v1/guide/content-authoring/SOURCES" });
    expect(sources.statusCode).toBe(404);
  });

  it("describes one operation and refuses unknown ones", async () => {
    const { app } = api();
    const described = (await app.inject({ method: "GET", url: "/v1/operations/get_claim" })).json();
    expect(described).toMatchObject({ operation: "get_claim", kind: "read", request: { path: "/v1/reads/get_claim" } });
    expect(described.input.properties.claim_id).toBeDefined();
    const unknown = await app.inject({ method: "GET", url: "/v1/operations/register_asset" });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().code).toBe("UNKNOWN_OPERATION");
  });

  it("searches the schema and reads pages through the schema port", async () => {
    const schema = new RecordingSchema();
    const app = buildApiServer({ service: new ProductService(new EchoDatabase(), storage), schema });
    const search = await app.inject({
      method: "GET",
      url: "/v1/schema/search?query=verified%20claims&limit=3&kind=view",
    });
    expect(search.json().head).toEqual(head);
    const page = await app.inject({ method: "GET", url: "/v1/schema/pages/relations/api/verified_claims.md" });
    expect(page.json()).toMatchObject({ head, page: "relations/api/verified_claims.md" });
    const term = await app.inject({ method: "GET", url: "/v1/schema/pages/search/terminology.json%23admission" });
    expect(term.statusCode).toBe(200);
    const entry = await app.inject({ method: "GET", url: "/v1/schema/pages" });
    expect(entry.json().page).toBe("START_HERE.md");
    expect(schema.asked).toEqual([
      { query: "verified claims", options: { limit: 3, kind: "view" } },
      { page: "relations/api/verified_claims.md" },
      { page: "search/terminology.json#admission" },
      { page: undefined },
    ]);
    expect((await app.inject({ method: "GET", url: "/v1/schema/search" })).statusCode).toBe(422);
    expect((await app.inject({ method: "GET", url: "/v1/schema/search?query=x&limit=many" })).statusCode).toBe(422);
  });

  it("answers NOT_AVAILABLE for schema routes when no workspace is configured", async () => {
    const response = await api().app.inject({ method: "GET", url: "/v1/schema/search?query=claims" });
    expect(response.statusCode).toBe(501);
    expect(response.json().code).toBe("NOT_AVAILABLE");
  });
});

describe("knowledge reads", () => {
  const headers = { authorization: "Bearer user" };

  it("serves a knowledge operation through the generic read route as the caller", async () => {
    const seen: unknown[] = [];
    const knowledge: KnowledgeReader = {
      read: async (session, operation, payload) => {
        seen.push({ session, operation, payload });
        return { query: "retries", lenses: ["corpus", "evidence"], hits: [] };
      },
    };
    const database = new EchoDatabase();
    const app = buildApiServer({ service: new ProductService(database, storage, knowledge) });
    const response = await app.inject({
      method: "POST",
      url: "/v1/reads/search_knowledge",
      headers,
      payload: { payload: { query: "retries", lenses: ["evidence"] } },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().hits).toEqual([]);
    expect(seen).toEqual([
      {
        session: { accessToken: "user" },
        operation: "search_knowledge",
        payload: { query: "retries", lenses: ["evidence"] },
      },
    ]);
    expect(database.last).toBeUndefined();
  });

  it("requires a session, validates the payload and reports an unavailable reader as 501", async () => {
    const { app } = api();
    const body = { payload: { claim_id: "0193e3c1-6f5a-7c3e-9a1b-2c3d4e5f6a7b" } };
    expect((await app.inject({ method: "POST", url: "/v1/reads/get_claim", payload: body })).statusCode).toBe(401);
    const invalid = await app.inject({
      method: "POST",
      url: "/v1/reads/search_knowledge",
      headers,
      payload: { payload: { query: "x", lenses: ["private"] } },
    });
    expect(invalid.statusCode).toBe(422);
    const unavailable = await app.inject({ method: "POST", url: "/v1/reads/get_claim", headers, payload: body });
    expect(unavailable.statusCode).toBe(501);
    expect(unavailable.json()).toMatchObject({ code: "NOT_AVAILABLE", message: "NOT_AVAILABLE" });
  });

  it("lists the knowledge reads in the public catalog", async () => {
    const response = await api().app.inject({ method: "GET", url: "/v1/operations" });
    const names = response.json().operations.map((operation: { name: string }) => operation.name);
    expect(names).toEqual(expect.arrayContaining([...knowledgeOperations]));
  });

  it("checks a client token's read scope before a knowledge read: 403 without it, and no check without a token", async () => {
    const reads: string[] = [];
    const knowledge: KnowledgeReader = {
      read: async (_session, operation) => {
        reads.push(operation);
        return { attention: [], probe_revalidation: [], releases_needing_review: [], counts: {} };
      },
    };
    const database = new EchoDatabase();
    const app = buildApiServer({ service: new ProductService(database, storage, knowledge) });
    const due = (token?: string) =>
      app.inject({
        method: "POST",
        url: "/v1/reads/list_due",
        headers: { ...headers, ...(token ? { "x-aieng-client-token": token } : {}) },
        payload: { payload: {} },
      });
    expect((await due()).statusCode).toBe(200);
    expect(database.scopes).toEqual([]);
    expect((await due("aiec_read")).statusCode).toBe(200);
    const denied = await due("aiec_learn_only");
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ code: "CLIENT_SCOPE_DENIED" });
    expect(database.scopes).toEqual([
      { clientToken: "aiec_read", scope: "read" },
      { clientToken: "aiec_learn_only", scope: "read" },
    ]);
    expect(reads).toEqual(["list_due", "list_due"]);
  });
});
