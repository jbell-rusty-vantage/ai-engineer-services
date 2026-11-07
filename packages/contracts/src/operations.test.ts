import { describe, expect, it } from "vitest";
import { httpStatusForError, productErrorCodes } from "./errors.js";
import { findOperation, operationCatalog, publicOperations } from "./operations.js";
import { payloadSchemas } from "./payloads.js";

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
  });
});
