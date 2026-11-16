import { ProductError } from "@aiengineer/service-contracts";
import type { CallerSession } from "../session.js";
import type { KnowledgeDatabase } from "./knowledge-database.js";

interface KnowledgeHead {
  readonly knowledge_seq: number | string | null;
}

/** The sequence of the last sealed knowledge batch this session can see; 0 when it sees none. */
export async function knowledgeHead(database: KnowledgeDatabase, session: CallerSession): Promise<number> {
  const head = await database.call<KnowledgeHead[] | null>(session, "knowledge_head", {});
  return Number(head?.[0]?.knowledge_seq ?? 0);
}

function notAvailable(operation: string): ProductError {
  return new ProductError(
    "NOT_AVAILABLE",
    `${operation}: the database shows this session no sealed knowledge (api.knowledge_head is 0), so an empty answer cannot be told from a missing tenant context; the database contract needs migration 20261115130000 or later`,
  );
}

/**
 * The error for a tenant-scoped reader that found nothing: `NOT_FOUND` when the session sees sealed knowledge,
 * `NOT_AVAILABLE` when it sees none.
 *
 * Most knowledge views and functions (`api.verified_claims`, `api.claim_candidates`, `api.entity_card`,
 * `api.releases_needing_review`, `api.changes_since`, ...) filter on the session's tenant. Since database contract
 * migration 20261115130000 (Build 08 D-82) a signed-in request resolves to the deployment's tenant, so they answer.
 * Against a database without that migration, or with nothing ingested, they return no rows, which an agent would read
 * as "not found" or "nothing due". `api.knowledge_head()` tells the two apart; it is asked only when a read is empty.
 */
export async function emptyReadError(
  database: KnowledgeDatabase,
  session: CallerSession,
  operation: string,
  notFound: string,
): Promise<ProductError> {
  return (await knowledgeHead(database, session)) > 0
    ? new ProductError("NOT_FOUND", notFound)
    : notAvailable(operation);
}

/**
 * For a list whose empty answer is a real answer ("nothing due"): refuses it only when the session sees no knowledge.
 * Returns the knowledge head.
 */
export async function requireVisibleKnowledge(
  database: KnowledgeDatabase,
  session: CallerSession,
  operation: string,
): Promise<number> {
  const head = await knowledgeHead(database, session);
  if (head === 0) throw notAvailable(operation);
  return head;
}
