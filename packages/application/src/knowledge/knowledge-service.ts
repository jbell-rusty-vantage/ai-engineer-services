import type { JsonObject, KnowledgeOperation } from "@aiengineer/service-contracts";
import type { CallerSession } from "../session.js";
import { readClaim } from "./claim-reader.js";
import { type ListDuePayload, listDue } from "./due-reader.js";
import { type GetEntityPayload, readEntity } from "./entity-reader.js";
import type { KnowledgeDatabase } from "./knowledge-database.js";
import { type SearchKnowledgePayload, searchKnowledge } from "./search-knowledge.js";
import { type GetSourcePayload, readSource } from "./source-reader.js";

/** Serves the knowledge read operations; the payload has already passed the operation's edge schema. */
export interface KnowledgeReader {
  read(session: CallerSession, operation: KnowledgeOperation, payload: JsonObject): Promise<unknown>;
}

/** Knowledge reads composed from the `api` views and functions, with the caller's own session. */
export class KnowledgeService implements KnowledgeReader {
  constructor(private readonly database: KnowledgeDatabase) {}

  read(session: CallerSession, operation: KnowledgeOperation, payload: JsonObject): Promise<unknown> {
    switch (operation) {
      case "search_knowledge":
        return searchKnowledge(this.database, session, payload as SearchKnowledgePayload);
      case "get_claim":
        return readClaim(this.database, session, payload as { claim_id: string });
      case "get_entity":
        return readEntity(this.database, session, payload as GetEntityPayload);
      case "get_source":
        return readSource(this.database, session, payload as GetSourcePayload);
      case "list_due":
        return listDue(this.database, session, payload as ListDuePayload);
    }
  }
}
