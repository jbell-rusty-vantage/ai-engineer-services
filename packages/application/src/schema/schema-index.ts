/** One entry of the workspace's `search/index.json`: a domain, relation, function, operation, query, task or term. */
export interface SchemaIndexEntry {
  readonly id: string;
  readonly kind: string;
  readonly lens: string | null;
  readonly domain: string | null;
  readonly path: string;
  readonly qualified_name: string;
  readonly summary: string | null;
  readonly tokens: readonly string[];
  readonly aliases: readonly string[];
}

export interface SchemaIndex {
  readonly entries: readonly SchemaIndexEntry[];
  /** `search/aliases.json`: a phrase to the ids it names. */
  readonly aliases: Readonly<Record<string, readonly string[]>>;
}

export interface RankedEntries {
  readonly total: number;
  readonly entries: readonly SchemaIndexEntry[];
}

const weights = {
  exactName: 100,
  alias: 60,
  name: 40,
  namePart: 20,
  nameContains: 12,
  token: 8,
  entryAlias: 6,
  tokenContains: 3,
  summary: 2,
} as const;

function words(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9_.]+/)
        .filter((word) => word.length >= 2),
    ),
  ];
}

/** A word and its singular or plural, so `claims` finds `claim`. */
function variants(word: string): string[] {
  return word.length > 3 && word.endsWith("s") ? [word, word.slice(0, -1)] : [word, `${word}s`];
}

function wordScore(entry: SchemaIndexEntry, name: string, localName: string, word: string): number {
  const nameParts = name.split(/[._-]/);
  let best = 0;
  for (const variant of variants(word)) {
    if (localName === variant || name === variant) best = Math.max(best, weights.name);
    else if (nameParts.includes(variant)) best = Math.max(best, weights.namePart);
    else if (name.includes(variant)) best = Math.max(best, weights.nameContains);
    else if (entry.tokens.includes(variant)) best = Math.max(best, weights.token);
    else if (entry.aliases.some((alias) => alias.toLowerCase().includes(variant)))
      best = Math.max(best, weights.entryAlias);
    else if (entry.tokens.some((token) => token.includes(variant))) best = Math.max(best, weights.tokenContains);
    else if (entry.summary?.toLowerCase().includes(variant)) best = Math.max(best, weights.summary);
  }
  return best;
}

/** A small preference for what an agent reads first: the `api` read surface and the domain and task pages. */
function prior(entry: SchemaIndexEntry): number {
  if (entry.kind === "domain" || entry.kind === "task") return 4;
  if (entry.qualified_name.startsWith("api.")) return 5;
  return entry.lens === "machinery" || entry.lens === "legacy" ? -3 : 0;
}

/**
 * Deterministic ranking over the index: exact names and curated aliases first, then name parts, columns and
 * summaries. Entries that match every word win; when none does, entries that match any word are returned.
 */
export function rankSchemaEntries(index: SchemaIndex, query: string, kind?: string): RankedEntries {
  const phrase = query.toLowerCase().trim().replace(/\s+/g, " ");
  const joined = phrase.replace(/ /g, "_");
  const queryWords = words(query);
  const aliasIds = new Set(index.aliases[phrase] ?? []);
  const scored: { entry: SchemaIndexEntry; score: number; complete: boolean }[] = [];
  for (const entry of index.entries) {
    if (kind && entry.kind !== kind) continue;
    const name = entry.qualified_name.toLowerCase();
    const localName = name.slice(name.lastIndexOf(".") + 1);
    const exact = name === phrase || name === joined || localName === joined;
    const alias = aliasIds.has(entry.id);
    const scores = queryWords.map((word) => wordScore(entry, name, localName, word));
    const matched = scores.filter((score) => score > 0).length;
    if (!exact && !alias && matched === 0) continue;
    const score =
      (exact ? weights.exactName : 0) + (alias ? weights.alias : 0) + scores.reduce((sum, value) => sum + value, 0);
    scored.push({ entry, score: score + prior(entry), complete: exact || alias || matched === queryWords.length });
  }
  const complete = scored.filter((candidate) => candidate.complete);
  const ranked = (complete.length > 0 ? complete : scored).sort(
    (left, right) =>
      right.score - left.score || left.entry.qualified_name.localeCompare(right.entry.qualified_name, "en"),
  );
  return { total: ranked.length, entries: ranked.map((candidate) => candidate.entry) };
}
