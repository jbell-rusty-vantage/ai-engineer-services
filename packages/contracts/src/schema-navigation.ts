/**
 * Schema navigation over the generated schema workspace of `ai-engineer-db-contract` (read-only files, no database
 * call). Every answer carries the workspace head so a stale workspace is visible.
 */

/** Identity of the generated workspace, read from its `fingerprint.json`. */
export interface SchemaWorkspaceHead {
  readonly migration_head: string;
  readonly contract_version: string;
  readonly fingerprint: string;
}

export interface SchemaSearchEntry {
  readonly kind: string;
  readonly name: string;
  readonly lens: string | null;
  readonly domain: string | null;
  /** The page to read with `schema_get`. */
  readonly path: string;
  readonly summary: string | null;
}

export interface SchemaSearchResult {
  readonly head: SchemaWorkspaceHead;
  readonly query: string;
  readonly total: number;
  readonly results: readonly SchemaSearchEntry[];
  readonly next: string;
}

export interface SchemaPage {
  readonly head: SchemaWorkspaceHead;
  readonly page: string;
  readonly bytes: number;
  readonly truncated: boolean;
  readonly text: string;
}

/** Kinds of entries in the workspace search index. */
export const schemaEntryKinds = [
  "domain",
  "task",
  "table",
  "partitioned_table",
  "view",
  "function",
  "operation",
  "query",
  "vocabulary",
  "term",
] as const;

export interface SchemaSearchOptions {
  readonly limit?: number;
  /** Restrict to one entry kind (`schemaEntryKinds`). */
  readonly kind?: string;
}

/** Implemented in process by the application (API, remote MCP) and over HTTP by the client (CLI, local MCP). */
export interface SchemaPort {
  searchSchema(query: string, options?: SchemaSearchOptions): Promise<SchemaSearchResult>;
  getSchemaPage(page?: string): Promise<SchemaPage>;
}

/** A page larger than this is cut on a line boundary and marked `truncated`. */
export const schemaPageByteLimit = 24 * 1024;
export const schemaEntryPage = "START_HERE.md";
export const schemaSearchLimits = { default: 8, maximum: 25 } as const;

/** The workspace's own navigation rule, repeated in every search answer. */
export const schemaReadRule =
  "Four reads at most: this search, the domain or task page, one relation, function or operation page, then run it.";

export function formatSchemaHead(head: SchemaWorkspaceHead): string {
  return `schema workspace: migration head ${head.migration_head}, contract ${head.contract_version}, fingerprint ${head.fingerprint}`;
}

/** Text form of a page for the MCP tool and the CLI: one head line, then the page. */
export function formatSchemaPage(page: SchemaPage): string {
  const size = `${page.bytes} bytes${page.truncated ? `, truncated to ${schemaPageByteLimit}` : ""}`;
  return `${formatSchemaHead(page.head)} (page ${page.page}, ${size})\n\n${page.text}`;
}
