import type { JsonObject } from "@aiengineer/service-contracts";
import type { ServiceConfig } from "./config.js";
import { PostgrestTransport } from "./postgrest-transport.js";
import type { CallerSession } from "./session.js";

export { productErrorFromPostgrest } from "./postgrest-transport.js";

export interface CommandCall {
  readonly workspaceId: string | null;
  readonly operation: string;
  readonly idempotencyKey: string;
  readonly expectedHead: string | null;
  readonly payload: JsonObject;
}

export interface ReadCall {
  readonly workspaceId: string | null;
  readonly operation: string;
  readonly payload: JsonObject;
}

/** The product database layer (`api.product_command`, `api.product_read`, `api.product_worker`). */
export interface DatabaseGateway {
  command(session: CallerSession, call: CommandCall): Promise<JsonObject>;
  read(session: CallerSession, call: ReadCall): Promise<unknown>;
  worker(operation: string, payload: JsonObject): Promise<JsonObject>;
}

/** Calls the database functions through PostgREST so row security and grants run as the caller. */
export class PostgrestDatabaseGateway implements DatabaseGateway {
  private readonly transport: PostgrestTransport;

  constructor(config: ServiceConfig, fetchImpl: typeof fetch = fetch) {
    this.transport = new PostgrestTransport(config, fetchImpl);
  }

  command(session: CallerSession, call: CommandCall): Promise<JsonObject> {
    return this.transport.rpc<JsonObject>(
      "product_command",
      {
        p_workspace_id: call.workspaceId,
        p_operation: call.operation,
        p_idempotency_key: call.idempotencyKey,
        p_expected_head: call.expectedHead,
        p_payload: call.payload,
      },
      this.transport.callerHeaders(session),
    );
  }

  read(session: CallerSession, call: ReadCall): Promise<unknown> {
    return this.transport.rpc(
      "product_read",
      { p_workspace_id: call.workspaceId, p_operation: call.operation, p_payload: call.payload },
      this.transport.callerHeaders(session),
    );
  }

  worker(operation: string, payload: JsonObject): Promise<JsonObject> {
    return this.transport.rpc<JsonObject>(
      "product_worker",
      { p_operation: operation, p_payload: payload },
      this.transport.serviceHeaders(),
    );
  }
}
