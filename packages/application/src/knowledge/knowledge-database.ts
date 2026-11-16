import type { JsonObject } from "@aiengineer/service-contracts";
import type { ServiceConfig } from "../config.js";
import { PostgrestTransport } from "../postgrest-transport.js";
import type { CallerSession } from "../session.js";

export interface RowQuery {
  readonly columns: readonly string[];
  /** PostgREST filters by column, for example `{ claim_id: "eq.<uuid>" }`. */
  readonly filters?: Readonly<Record<string, string>>;
  /** A PostgREST `or` group, for example `(claim_id.eq.<uuid>,original_claim_id.eq.<uuid>)`. */
  readonly either?: string;
  readonly order?: string;
  readonly limit?: number;
}

/**
 * The knowledge read surface of the database: the `api` views and functions documented in the schema workspace of
 * `ai-engineer-db-contract`. Every call runs with the caller's own session.
 */
export interface KnowledgeDatabase {
  /** Calls an `api` function with named arguments. */
  call<T>(session: CallerSession, functionName: string, args: JsonObject): Promise<T>;
  /** Reads rows of an `api` view. */
  rows<T>(session: CallerSession, relation: string, query: RowQuery): Promise<T[]>;
}

export class PostgrestKnowledgeDatabase implements KnowledgeDatabase {
  private readonly transport: PostgrestTransport;

  constructor(config: ServiceConfig, fetchImpl: typeof fetch = fetch) {
    this.transport = new PostgrestTransport(config, fetchImpl);
  }

  call<T>(session: CallerSession, functionName: string, args: JsonObject): Promise<T> {
    return this.transport.rpc<T>(functionName, args, this.transport.callerHeaders(session));
  }

  rows<T>(session: CallerSession, relation: string, query: RowQuery): Promise<T[]> {
    const search = new URLSearchParams({ select: query.columns.join(",") });
    for (const [column, filter] of Object.entries(query.filters ?? {})) search.set(column, filter);
    if (query.either) search.set("or", query.either);
    if (query.order) search.set("order", query.order);
    if (query.limit) search.set("limit", String(query.limit));
    return this.transport.select<T>(relation, search, this.transport.callerHeaders(session));
  }
}
