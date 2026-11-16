import { ProductError } from "@aiengineer/service-contracts";
import type { CallerSession } from "../session.js";
import type { KnowledgeDatabase } from "./knowledge-database.js";

interface KnowledgeHead {
  readonly knowledge_seq: number | string | null;
}

/**
 * Refuses a read whose database objects filter on `util.current_tenant_id()` when the session has no tenant context.
 *
 * Most knowledge views and functions (`api.verified_claims`, `api.claim_candidates`, `api.entity_card`,
 * `api.releases_needing_review`, `api.changes_since`, ...) filter on that function, which reads the `app.tenant_id`
 * setting. PostgREST requests do not set it, so those readers return no rows, which an agent would read as "nothing
 * known" or "nothing due" (Build 08 D-82). `api.knowledge_head()` has the same dependency and always returns one row:
 * sequence 0 means no sealed knowledge is visible to this session. Remove this check once the database gives
 * authenticated requests a tenant context.
 */
export async function requireKnowledgeTenantContext(
  database: KnowledgeDatabase,
  session: CallerSession,
  operation: string,
): Promise<void> {
  const head = await database.call<KnowledgeHead[] | null>(session, "knowledge_head", {});
  if (Number(head?.[0]?.knowledge_seq ?? 0) > 0) return;
  throw new ProductError(
    "NOT_AVAILABLE",
    `${operation}: the database gives this session no knowledge tenant context (api.knowledge_head reports no sealed knowledge), so the tenant-scoped readers would return nothing`,
  );
}
