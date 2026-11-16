import { describe, expect, it } from "vitest";
import { httpStatusForError, productErrorCodes } from "./errors.js";
import { isKnowledgeOperation, knowledgeOperations } from "./knowledge.js";
import { findOperation, operationCatalog, publicOperations } from "./operations.js";
import { payloadSchemas } from "./payloads.js";

const id = "0193e3c1-6f5a-7c3e-9a1b-2c3d4e5f6a7b";

describe("operation catalog", () => {
  it("names every operation once and in snake_case", () => {
    for (const name of operationCatalog.keys()) expect(name).toMatch(/^[a-z]+(_[a-z]+)*$/);
  });

  it("only defines payload schemas for catalogued operations", () => {
    for (const name of Object.keys(payloadSchemas)) expect(operationCatalog.has(name)).toBe(true);
  });

  it("keeps composite operations off the public surfaces", () => {
    expect(publicOperations().map((operation) => operation.name)).not.toContain("register_asset");
  });

  it("finds operations by kind", () => {
    expect(findOperation("search", "read")?.scope).toBe("read");
    expect(findOperation("search", "command")).toBeUndefined();
  });

  it("rejects unknown payload fields on strict operations", () => {
    expect(findOperation("search", "read")?.payload.safeParse({ query: "x", sql: "drop" }).success).toBe(false);
  });

  it("validates research payloads at the edge", () => {
    const support = findOperation("add_support", "command")?.payload;
    expect(
      support?.safeParse({
        subject: { assertion_id: "0193e3c1-6f5a-7c3e-9a1b-2c3d4e5f6a7b" },
        role: "contradicts",
        target: { kind: "source_revision", id: "0193e3c1-6f5a-7c3e-9a1b-2c3d4e5f6a7c" },
      }).success,
    ).toBe(true);
    expect(support?.safeParse({ subject: {}, role: "supports" }).success).toBe(false);
    const accept = findOperation("accept_research", "command")?.payload;
    expect(
      accept?.safeParse({ revision_id: "0193e3c1-6f5a-7c3e-9a1b-2c3d4e5f6a7b", execution_origin: "anywhere" }).success,
    ).toBe(false);
  });

  it("maps every error code to an HTTP status", () => {
    for (const code of productErrorCodes) expect(httpStatusForError(code)).toBeGreaterThanOrEqual(400);
    expect(httpStatusForError("NOT_AVAILABLE")).toBe(501);
  });

  it("catalogues the knowledge reads as public reads", () => {
    for (const name of knowledgeOperations) expect(findOperation(name, "read")?.exposure).toBe("public");
    expect(isKnowledgeOperation("search")).toBe(false);
  });

  it("keeps the knowledge search on the corpus and evidence lenses", () => {
    const search = findOperation("search_knowledge", "read")?.payload;
    expect(search?.safeParse({ query: "retries", lenses: ["corpus", "evidence"], tiers: [0, 2] }).success).toBe(true);
    expect(search?.safeParse({ query: "retries", lenses: ["private"] }).success).toBe(false);
    expect(search?.safeParse({ query: "retries", lenses: ["ours"] }).success).toBe(false);
    expect(search?.safeParse({ query: "retries", workspace_ids: [id] }).success).toBe(false);
    expect(search?.safeParse({ query: "retries", as_of: "yesterday" }).success).toBe(false);
  });

  it("reads an entity or a source by exactly one key", () => {
    const entity = findOperation("get_entity", "read")?.payload;
    expect(entity?.safeParse({ entity_id: id }).success).toBe(true);
    expect(entity?.safeParse({ library: "langgraph" }).success).toBe(true);
    expect(entity?.safeParse({ entity_id: id, library: "langgraph" }).success).toBe(false);
    expect(findOperation("get_source", "read")?.payload.safeParse({}).success).toBe(false);
    expect(findOperation("list_due", "read")?.payload.safeParse({}).success).toBe(true);
  });
});
