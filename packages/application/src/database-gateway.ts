import { type JsonObject, type OperationScope, ProductError } from "@aiengineer/service-contracts";
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

/**
 * The product database layer (`api.product_command`, `api.product_read`, `api.product_scope`, `api.product_worker`) and
 * the release the database states (`api.database_release`).
 */
export interface DatabaseGateway {
  command(session: CallerSession, call: CommandCall): Promise<JsonObject>;
  read(session: CallerSession, call: ReadCall): Promise<unknown>;
  /**
   * The client-grant check `command` and `read` make inside the database, on its own, for an operation the application
   * serves outside them: rejects with `CLIENT_GRANT_INVALID` or `CLIENT_SCOPE_DENIED` when the caller's client token
   * does not allow the scope.
   */
  scope(session: CallerSession, scope: OperationScope): Promise<JsonObject>;
  worker(operation: string, payload: JsonObject): Promise<JsonObject>;
  /**
   * What the database says about its release (`api.database_release()`), asked once when a transport starts. No
   * caller exists then and `anon` may not execute the function, so this is a deployment-level read made with the
   * service key, like a worker call; it reads no user data. Resolves to the function's JSON and rejects when the
   * database cannot be asked (unreachable, function missing, not permitted, no service key).
   */
  databaseRelease(): Promise<unknown>;
}

/** How long the release read at startup may take before the database counts as not answering. */
export const databaseReleaseTimeoutMilliseconds = 10_000;

/** Calls the database functions through PostgREST so row security and grants run as the caller. */
export class PostgrestDatabaseGateway implements DatabaseGateway {
  private readonly transport: PostgrestTransport;
  private readonly serviceKeyConfigured: boolean;

  constructor(config: ServiceConfig, fetchImpl: typeof fetch = fetch) {
    this.transport = new PostgrestTransport(config, fetchImpl);
    this.serviceKeyConfigured = config.databaseSecretKey.trim() !== "";
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

  scope(session: CallerSession, scope: OperationScope): Promise<JsonObject> {
    return this.transport.rpc<JsonObject>("product_scope", { p_scope: scope }, this.transport.callerHeaders(session));
  }

  worker(operation: string, payload: JsonObject): Promise<JsonObject> {
    return this.transport.rpc<JsonObject>(
      "product_worker",
      { p_operation: operation, p_payload: payload },
      this.transport.serviceHeaders(),
    );
  }

  async databaseRelease(): Promise<unknown> {
    if (!this.serviceKeyConfigured)
      throw new ProductError("NOT_AVAILABLE", "no service key is configured for the release read");
    return this.transport.rpc<unknown>(
      "database_release",
      {},
      this.transport.serviceHeaders(),
      AbortSignal.timeout(databaseReleaseTimeoutMilliseconds),
    );
  }
}
