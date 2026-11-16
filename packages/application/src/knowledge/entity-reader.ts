import { type PayloadSchemas, ProductError } from "@aiengineer/service-contracts";
import type { z } from "zod";
import type { CallerSession } from "../session.js";
import { asRows, pick, type Row, smallJson } from "./compact.js";
import type { KnowledgeDatabase } from "./knowledge-database.js";
import { requireKnowledgeTenantContext } from "./tenant-context.js";

export type GetEntityPayload = z.infer<PayloadSchemas["get_entity"]>;

/** How many entries of each list an answer keeps; `truncated` reports what was left out. */
const cardLimits = { aliases: 20, facts: 25, relationships: 25, events: 10, sources: 10 } as const;
const dossierLimits = { probes: 12, verdicts: 10 } as const;

const entityColumns = ["id", "kind", "slug", "display_name", "summary", "lifecycle", "merged_into_id", "updated_at"];
const factColumns = [
  "stream_kind",
  "scope_key",
  "status",
  "amount",
  "currency",
  "unit",
  "ref_display_name",
  "valid_during",
  "belief",
];
const relationshipColumns = ["kind", "from_entity_id", "to_entity_id", "qualifier"];

function limited(rows: readonly unknown[], limit: number, name: string, truncated: Record<string, number>): unknown[] {
  if (rows.length > limit) truncated[name] = rows.length - limit;
  return rows.slice(0, limit);
}

/** `api.entity_card`: the entity with its current facts, relationships, events and sources. */
function compactCard(card: Row): Row {
  const entity = card.entity as Row;
  const truncated: Record<string, number> = {};
  const list = (name: keyof typeof cardLimits) =>
    limited(Array.isArray(card[name]) ? card[name] : [], cardLimits[name], name, truncated);
  return {
    kind: "entity_card",
    entity: { ...pick(entity, entityColumns), attributes: smallJson(entity.attributes, 1200) },
    aliases: list("aliases"),
    facts: (list("facts") as Row[]).map((fact) => ({
      ...pick(fact, factColumns),
      payload: smallJson(fact.payload, 300),
    })),
    relationships: (list("relationships") as Row[]).map((relationship) => pick(relationship, relationshipColumns)),
    events: list("events"),
    sources: list("sources"),
    truncated,
  };
}

/** `api.library_dossier`: releases, claims by status, open community claims, probes and ranked sources. */
function compactDossier(dossier: Row): Row {
  const probes = asRows(dossier.probes)
    .slice(0, dossierLimits.probes)
    .map((probe) => ({ ...probe, verdicts: asRows(probe.verdicts).slice(0, dossierLimits.verdicts) }));
  return { kind: "library_dossier", ...dossier, probes };
}

/** One entity's card (by id) or one library's dossier (by slug or id). */
export async function readEntity(
  database: KnowledgeDatabase,
  session: CallerSession,
  payload: GetEntityPayload,
): Promise<Row> {
  if ("library" in payload) {
    const dossier = await database.call<Row | null>(session, "library_dossier", { p_library: payload.library });
    if (!dossier?.library) throw new ProductError("NOT_FOUND", "library");
    return compactDossier(dossier);
  }
  await requireKnowledgeTenantContext(database, session, "get_entity");
  const card = await database.call<Row | null>(session, "entity_card", { p_entity: payload.entity_id });
  if (!card?.entity) throw new ProductError("NOT_FOUND", "entity");
  return compactCard(card);
}
