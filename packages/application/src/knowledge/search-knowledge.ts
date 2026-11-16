import {
  type EvidenceSignal,
  type KnowledgeHit,
  type KnowledgeSearchResult,
  knowledgeLenses,
  type PayloadSchemas,
  type ReadMore,
} from "@aiengineer/service-contracts";
import type { z } from "zod";
import type { CallerSession } from "../session.js";
import { oneLine } from "./compact.js";
import type { KnowledgeDatabase } from "./knowledge-database.js";

export type SearchKnowledgePayload = z.infer<PayloadSchemas["search_knowledge"]>;

/** The columns of `api.search_knowledge` this service reads. */
interface SearchRow {
  readonly vector_item_id: string;
  readonly lens: string;
  readonly source_tier: number | null;
  readonly content_kind: string | null;
  readonly entity_id: string | null;
  readonly document_id: string | null;
  readonly target_kind: string | null;
  readonly target_id: string | null;
  readonly snippet: string | null;
  readonly observed_at: string | null;
  readonly space_slug: string;
  readonly fused_score: number;
  readonly channel_scores: { readonly evidence?: Readonly<Record<string, unknown>> | null } | null;
}

const defaultLimit = 10;
const titleLength = 80;
const snippetLength = 240;
const noMatchNote =
  "No match. Search is keyword based: use fewer, more specific terms, or widen lenses, tiers, spaces or kinds.";

function evidenceOf(row: SearchRow): EvidenceSignal | null {
  const evidence = row.channel_scores?.evidence;
  if (!evidence) return null;
  return {
    signal: Number(evidence.signal ?? 0),
    verdict: typeof evidence.verdict === "string" ? evidence.verdict : null,
    claims: Number(evidence.claims ?? 0),
  };
}

function readMoreOf(row: SearchRow): ReadMore | null {
  if (row.target_kind === "claim" && row.target_id)
    return { operation: "get_claim", payload: { claim_id: row.target_id } };
  const entityId = row.target_kind === "entity" ? row.target_id : row.entity_id;
  return entityId ? { operation: "get_entity", payload: { entity_id: entityId } } : null;
}

/** The first line of the matched text; the function returns no title of its own. */
function titleOf(snippet: string): string {
  return oneLine(snippet.trim().split("\n")[0] ?? "", titleLength);
}

function toHit(row: SearchRow): KnowledgeHit {
  const snippet = row.snippet ?? "";
  return {
    ref: `${row.target_kind ?? "item"}:${row.target_id ?? row.vector_item_id}`,
    kind: row.target_kind ?? row.content_kind ?? "item",
    title: titleOf(snippet),
    snippet: oneLine(snippet, snippetLength),
    score: Math.round(row.fused_score * 10_000) / 10_000,
    lens: row.lens,
    tier: row.source_tier,
    space: row.space_slug,
    evidence: evidenceOf(row),
    read_more: readMoreOf(row),
    ...(row.entity_id ? { entity_id: row.entity_id } : {}),
    ...(row.document_id ? { document_id: row.document_id } : {}),
    ...(row.observed_at ? { observed_at: row.observed_at } : {}),
  };
}

/**
 * `api.search_knowledge`: the search a signed-in session may call, over the corpus and evidence lenses only. It has no
 * workspace parameter and refuses any other lens; `api.search_unified`, which takes the private scope from its caller,
 * is not executable by a user session (database contract migration 20261115130000). No query embedding is sent, so the
 * full-text and trigram channels rank the hits.
 */
export async function searchKnowledge(
  database: KnowledgeDatabase,
  session: CallerSession,
  payload: SearchKnowledgePayload,
): Promise<KnowledgeSearchResult> {
  const lenses: readonly string[] = payload.lenses ?? knowledgeLenses;
  const rows = await database.call<SearchRow[] | null>(session, "search_knowledge", {
    p_query: payload.query,
    p_lenses: [...lenses],
    ...(payload.tiers ? { p_tiers: payload.tiers } : {}),
    ...(payload.spaces ? { p_space_slugs: payload.spaces } : {}),
    ...(payload.kinds ? { p_content_kinds: payload.kinds } : {}),
    ...(payload.as_of ? { p_as_of: payload.as_of } : {}),
    p_limit: payload.limit ?? defaultLimit,
    p_collapse: payload.collapse ?? true,
  });
  const hits = (rows ?? []).filter((row) => lenses.includes(row.lens)).map(toHit);
  return { query: payload.query, lenses, hits, ...(hits.length === 0 ? { note: noMatchNote } : {}) };
}
