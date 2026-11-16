import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatSchemaPage, schemaPageByteLimit } from "@aiengineer/service-contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SchemaWorkspace } from "./schema-workspace.js";
import { resolveSchemaWorkspaceDirectory } from "./schema-workspace-location.js";

const fingerprint = {
  fingerprint: "sha256:build",
  inputs: { contract_version: "0.6.0", migration_head: "20261115120100" },
  workspace_fingerprint: "sha256:fixture",
};

const entry = (kind: string, name: string, path: string, extra: Record<string, unknown> = {}) => ({
  id: `${kind}:${name}`,
  kind,
  lens: "corpus",
  domain: "api-surface",
  path,
  qualified_name: name,
  summary: null,
  tokens: name.split("."),
  aliases: [],
  ...extra,
});

const index = [
  entry("domain", "evidence", "domains/evidence.md", {
    id: "dom:evidence",
    domain: "evidence",
    lens: "evidence",
    summary: "Source to capture to locator to claim",
    aliases: ["claims", "where was it read"],
  }),
  entry("view", "api.verified_claims", "relations/api/verified_claims.md", {
    id: "rel:api.verified_claims",
    summary: "Claims that reached verified through an admission, with the use decision and the receipt.",
    tokens: ["api", "verified_claims", "api.verified_claims", "claim_id", "statement", "receipt_id"],
  }),
  entry("view", "api.claim_verdicts", "relations/api/claim_verdicts.md", {
    id: "rel:api.claim_verdicts",
    tokens: ["api", "claim_verdicts", "api.claim_verdicts", "claim_id", "verdict", "probe"],
  }),
  entry("table", "evidence.claim", "relations/evidence/claim.md", {
    id: "rel:evidence.claim",
    domain: "evidence",
    lens: "evidence",
    tokens: ["evidence", "claim", "evidence.claim", "statement", "status"],
  }),
  entry("function", "api.search_unified", "functions/api/search_unified.md", { id: "fn:api.search_unified" }),
  entry("operation", "create_work", "ops/create_work.md", { id: "op:create_work", lens: "ours" }),
  entry("term", "admission", "search/terminology.json#admission", { id: "term:admission", domain: null }),
];

let root: string;
let workspace: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "aieng-schema-"));
  workspace = join(root, "ai-engineer-db-contract", "workspace");
  for (const directory of ["search", "relations/api", "domains"])
    await mkdir(join(workspace, directory), { recursive: true });
  await writeFile(join(workspace, "fingerprint.json"), JSON.stringify(fingerprint));
  await writeFile(join(workspace, "search", "index.json"), JSON.stringify(index));
  await writeFile(join(workspace, "search", "aliases.json"), JSON.stringify({ "use admission": ["term:admission"] }));
  await writeFile(
    join(workspace, "search", "terminology.json"),
    JSON.stringify({ admission: { definition: "Executor decision that a proposal becomes a fact." } }),
  );
  await writeFile(join(workspace, "START_HERE.md"), "# Start here\r\n\r\nFour reads, at most.\r\n");
  await writeFile(join(workspace, "relations", "api", "verified_claims.md"), "# api.verified_claims\n\nview\n");
  await writeFile(join(workspace, "domains", "long.md"), `# Long\n${"| column | type | notes |\n".repeat(1500)}`);
  await writeFile(join(workspace, "search", "large.json"), JSON.stringify({ blob: "x".repeat(schemaPageByteLimit) }));
  await writeFile(join(root, "outside.md"), "not part of the workspace");
  // A repository beside the contract checkout, to test the default location.
  await mkdir(join(root, "ai-engineer-service", "packages", "application", "dist"), { recursive: true });
  await writeFile(join(root, "ai-engineer-service", "pnpm-workspace.yaml"), "packages: []\n");
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const head = { migration_head: "20261115120100", contract_version: "0.6.0", fingerprint: "sha256:fixture" };

describe("schema search", () => {
  it("finds a relation by words, reports the workspace head and repeats the read rule", async () => {
    const result = await new SchemaWorkspace(workspace).searchSchema("verified claims");
    expect(result.head).toEqual(head);
    expect(result.results[0]).toEqual({
      kind: "view",
      name: "api.verified_claims",
      lens: "corpus",
      domain: "api-surface",
      path: "relations/api/verified_claims.md",
      summary: "Claims that reached verified through an admission, with the use decision and the receipt.",
    });
    expect(result.next).toContain("Four reads");
  });

  it("matches columns, plurals, curated aliases and exact names", async () => {
    const schema = new SchemaWorkspace(workspace);
    const names = async (query: string) => (await schema.searchSchema(query)).results.map((result) => result.name);
    expect(await names("receipt_id")).toEqual(["api.verified_claims"]);
    const claims = ["evidence.claim", "api.claim_verdicts", "api.verified_claims", "evidence"];
    expect(await names("claims")).toEqual(claims);
    expect(await names("claim")).toEqual(claims);
    expect(await names("use admission")).toEqual(["admission", "api.verified_claims"]);
    expect(await names("create_work")).toEqual(["create_work"]);
  });

  it("honours kind and limit, and falls back to any word when no entry has all of them", async () => {
    const schema = new SchemaWorkspace(workspace);
    const views = await schema.searchSchema("claim", { kind: "view", limit: 1 });
    expect(views.total).toBe(2);
    expect(views.results).toHaveLength(1);
    expect((await schema.searchSchema("search zebra")).results.map((result) => result.name)).toEqual([
      "api.search_unified",
    ]);
    expect((await schema.searchSchema("zebra")).results).toEqual([]);
  });

  it("is deterministic", async () => {
    const schema = new SchemaWorkspace(workspace);
    expect(await schema.searchSchema("claim")).toEqual(await schema.searchSchema("claim"));
  });
});

describe("schema pages", () => {
  it("returns the entry page by default, with the head in the text form", async () => {
    const page = await new SchemaWorkspace(workspace).getSchemaPage();
    expect(page).toEqual({
      head,
      page: "START_HERE.md",
      bytes: 35,
      truncated: false,
      text: "# Start here\n\nFour reads, at most.\n",
    });
    expect(formatSchemaPage(page).split("\n")[0]).toBe(
      "schema workspace: migration head 20261115120100, contract 0.6.0, fingerprint sha256:fixture (page START_HERE.md, 35 bytes)",
    );
  });

  it("reads a page by its path and one key of a JSON page", async () => {
    const schema = new SchemaWorkspace(workspace);
    expect((await schema.getSchemaPage("relations/api/verified_claims.md")).text).toContain("# api.verified_claims");
    expect((await schema.getSchemaPage("./relations\\api\\verified_claims.md")).page).toBe(
      "relations/api/verified_claims.md",
    );
    const term = await schema.getSchemaPage("search/terminology.json#admission");
    expect(term.page).toBe("search/terminology.json#admission");
    expect(JSON.parse(term.text)).toEqual({ definition: "Executor decision that a proposal becomes a fact." });
  });

  it("cuts a long page on a line boundary and says so", async () => {
    const page = await new SchemaWorkspace(workspace).getSchemaPage("domains/long.md");
    expect(page.truncated).toBe(true);
    expect(page.bytes).toBeGreaterThan(schemaPageByteLimit);
    expect(Buffer.byteLength(page.text, "utf8")).toBeLessThanOrEqual(schemaPageByteLimit);
    expect(page.text.endsWith("| column | type | notes |")).toBe(true);
    expect(formatSchemaPage(page)).toContain(`truncated to ${schemaPageByteLimit}`);
  });

  it("refuses paths that leave the workspace, other file types and whole large JSON files", async () => {
    const schema = new SchemaWorkspace(workspace);
    for (const page of ["../../outside.md", "/etc/passwd", "C:/Windows/win.ini", "relations//api/x.md", "a/../b.md"]) {
      await expect(schema.getSchemaPage(page), page).rejects.toMatchObject({ code: "VALIDATION" });
    }
    await expect(schema.getSchemaPage("fingerprint.exe")).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(schema.getSchemaPage("search/large.json")).rejects.toMatchObject({
      code: "VALIDATION",
      detail: expect.stringContaining("never read whole"),
    });
  });

  it("is NOT_FOUND for a missing page or JSON key", async () => {
    const schema = new SchemaWorkspace(workspace);
    await expect(schema.getSchemaPage("relations/api/nope.md")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(schema.getSchemaPage("relations/api")).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(schema.getSchemaPage("search/terminology.json#nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("is NOT_AVAILABLE when no workspace is configured or the directory is not one", async () => {
    await expect(new SchemaWorkspace(undefined).searchSchema("claim")).rejects.toMatchObject({ code: "NOT_AVAILABLE" });
    await expect(new SchemaWorkspace(root).getSchemaPage()).rejects.toMatchObject({
      code: "NOT_AVAILABLE",
      detail: expect.stringContaining("AIENG_SCHEMA_WORKSPACE_DIR"),
    });
  });
});

describe("schema workspace location", () => {
  it("uses AIENG_SCHEMA_WORKSPACE_DIR when it is set", () => {
    expect(resolveSchemaWorkspaceDirectory({ AIENG_SCHEMA_WORKSPACE_DIR: workspace }, tmpdir())).toBe(workspace);
  });

  it("defaults to the sibling contract checkout of the repository it runs from", () => {
    const start = join(root, "ai-engineer-service", "packages", "application", "dist");
    expect(resolveSchemaWorkspaceDirectory({}, start)).toBe(workspace);
  });

  it("is undefined when neither exists", () => {
    expect(resolveSchemaWorkspaceDirectory({}, join(root, "ai-engineer-db-contract"))).toBeUndefined();
  });
});

const sibling = resolveSchemaWorkspaceDirectory({});

describe.skipIf(!sibling || !existsSync(sibling))("the generated workspace beside this checkout", () => {
  const schema = new SchemaWorkspace(sibling);

  it("answers where verified claims live in at most four reads", async () => {
    const search = await schema.searchSchema("verified claims");
    expect(search.head.migration_head).toMatch(/^[0-9]{14}$/);
    expect(search.results.slice(0, 3).map((result) => result.name)).toContain("api.verified_claims");
    const hit = search.results.find((result) => result.name === "api.verified_claims");
    const page = await schema.getSchemaPage(hit?.path);
    expect(page.text).toContain("## Columns");
    expect(page.truncated).toBe(false);
  });

  it("serves the entry page and every page the index points at, whole", async () => {
    expect((await schema.getSchemaPage()).text).toContain("Four reads, at most");
    const index = JSON.parse(await readFile(join(sibling ?? "", "search", "index.json"), "utf8")) as { path: string }[];
    const paths = [...new Set(index.map((entry) => entry.path))];
    const pages = await Promise.all(paths.map((path) => schema.getSchemaPage(path)));
    expect(pages.filter((page) => page.truncated).map((page) => page.page)).toEqual([]);
    expect(pages.every((page) => page.text.length > 0)).toBe(true);
  });
});
