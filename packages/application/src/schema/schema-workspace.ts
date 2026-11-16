import { readFile, realpath, stat } from "node:fs/promises";
import { extname, join, sep } from "node:path";
import {
  ProductError,
  type SchemaPage,
  type SchemaPort,
  type SchemaSearchEntry,
  type SchemaSearchOptions,
  type SchemaSearchResult,
  type SchemaWorkspaceHead,
  schemaEntryPage,
  schemaPageByteLimit,
  schemaReadRule,
  schemaSearchLimits,
} from "@aiengineer/service-contracts";
import { rankSchemaEntries, type SchemaIndex, type SchemaIndexEntry } from "./schema-index.js";
import { schemaWorkspaceFingerprintFile } from "./schema-workspace-location.js";

const readableExtensions = new Set([".md", ".txt", ".json"]);
const summaryLength = 160;
const notConfigured =
  "schema navigation needs a generated schema workspace: set AIENG_SCHEMA_WORKSPACE_DIR to the workspace directory of ai-engineer-db-contract";

interface Fingerprint {
  readonly workspace_fingerprint?: string;
  readonly inputs?: { readonly migration_head?: string; readonly contract_version?: string };
}

function toSearchEntry(entry: SchemaIndexEntry): SchemaSearchEntry {
  const summary = entry.summary?.replace(/\s+/g, " ").trim();
  return {
    kind: entry.kind,
    name: entry.qualified_name,
    lens: entry.lens,
    domain: entry.domain,
    path: entry.path,
    summary: summary ? (summary.length > summaryLength ? `${summary.slice(0, summaryLength - 1)}…` : summary) : null,
  };
}

/** A path inside the workspace, with forward slashes; anything that could leave it is refused. */
function workspacePath(page: string): string {
  const path = page.replace(/\\/g, "/").replace(/^(\.\/)+/, "");
  const segments = path.split("/");
  const unsafe = path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.includes("\0");
  if (unsafe || segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new ProductError(
      "VALIDATION",
      "page must be a path inside the schema workspace, such as domains/evidence.md",
    );
  }
  return path;
}

/** Cuts text to the byte limit on a line boundary. */
function withinLimit(text: string): { text: string; truncated: boolean } {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.byteLength <= schemaPageByteLimit) return { text, truncated: false };
  const cut = bytes.subarray(0, schemaPageByteLimit).toString("utf8");
  return { text: cut.slice(0, Math.max(cut.lastIndexOf("\n"), 0)), truncated: true };
}

/**
 * Read-only access to the generated schema workspace (its `search/index.json` and page files). No database call.
 * The head is read on every call, so a regenerated workspace is picked up and a stale one is visible.
 */
export class SchemaWorkspace implements SchemaPort {
  private cached: { readonly fingerprint: string; readonly index: SchemaIndex } | undefined;

  constructor(private readonly directory: string | undefined) {}

  async searchSchema(query: string, options: SchemaSearchOptions = {}): Promise<SchemaSearchResult> {
    const text = query.trim();
    if (!text) throw new ProductError("VALIDATION", "query is required");
    const head = await this.head();
    const ranked = rankSchemaEntries(await this.index(head), text, options.kind);
    const limit = Math.min(Math.max(options.limit ?? schemaSearchLimits.default, 1), schemaSearchLimits.maximum);
    return {
      head,
      query: text,
      total: ranked.total,
      results: ranked.entries.slice(0, limit).map(toSearchEntry),
      next: schemaReadRule,
    };
  }

  async getSchemaPage(page?: string): Promise<SchemaPage> {
    const head = await this.head();
    const [requested = "", anchor] = (page?.trim() || schemaEntryPage).split("#", 2);
    const path = workspacePath(requested);
    const extension = extname(path).toLowerCase();
    if (!readableExtensions.has(extension)) {
      throw new ProductError("VALIDATION", "only .md, .txt and .json pages can be read");
    }
    const file = await this.resolve(path);
    if (extension === ".json") {
      if (anchor) return this.jsonEntry(head, file, path, anchor);
      if ((await stat(file)).size > schemaPageByteLimit) {
        throw new ProductError("VALIDATION", `${path} is never read whole; use schema search, or ${path}#<key>`);
      }
    }
    const whole = (await readFile(file, "utf8")).replace(/\r\n/g, "\n");
    const { text, truncated } = withinLimit(whole);
    return { head, page: path, bytes: Buffer.byteLength(whole, "utf8"), truncated, text };
  }

  /** One key of a JSON page, such as a term of `search/terminology.json`. */
  private async jsonEntry(head: SchemaWorkspaceHead, file: string, path: string, key: string): Promise<SchemaPage> {
    const document = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    if (!Object.hasOwn(document, key)) throw new ProductError("NOT_FOUND", `schema page ${path}#${key}`);
    const whole = JSON.stringify(document[key], null, 2);
    const { text, truncated } = withinLimit(whole);
    return { head, page: `${path}#${key}`, bytes: Buffer.byteLength(whole, "utf8"), truncated, text };
  }

  private async resolve(path: string): Promise<string> {
    const root = await realpath(this.requireDirectory());
    let file: string;
    try {
      file = await realpath(join(root, path));
    } catch {
      throw new ProductError("NOT_FOUND", `schema page ${path}`);
    }
    if (!file.startsWith(root + sep)) throw new ProductError("VALIDATION", "page is outside the schema workspace");
    if (!(await stat(file)).isFile()) throw new ProductError("NOT_FOUND", `schema page ${path}`);
    return file;
  }

  private requireDirectory(): string {
    if (!this.directory) throw new ProductError("NOT_AVAILABLE", notConfigured);
    return this.directory;
  }

  private async head(): Promise<SchemaWorkspaceHead> {
    let fingerprint: Fingerprint;
    try {
      fingerprint = JSON.parse(await readFile(join(this.requireDirectory(), schemaWorkspaceFingerprintFile), "utf8"));
    } catch (error) {
      if (error instanceof ProductError) throw error;
      throw new ProductError("NOT_AVAILABLE", notConfigured);
    }
    return {
      migration_head: fingerprint.inputs?.migration_head ?? "unknown",
      contract_version: fingerprint.inputs?.contract_version ?? "unknown",
      fingerprint: fingerprint.workspace_fingerprint ?? "unknown",
    };
  }

  private async index(head: SchemaWorkspaceHead): Promise<SchemaIndex> {
    if (this.cached?.fingerprint === head.fingerprint) return this.cached.index;
    const directory = join(this.requireDirectory(), "search");
    const [entries, aliases] = await Promise.all([
      readFile(join(directory, "index.json"), "utf8"),
      readFile(join(directory, "aliases.json"), "utf8"),
    ]);
    const index: SchemaIndex = { entries: JSON.parse(entries), aliases: JSON.parse(aliases) };
    this.cached = { fingerprint: head.fingerprint, index };
    return index;
  }
}
