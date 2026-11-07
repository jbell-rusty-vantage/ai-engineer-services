import {
  headerNames,
  isProductErrorCode,
  type JsonObject,
  ProductError,
  type ProductErrorCode,
} from "@aiengineer/service-contracts";
import type { ServiceConfig } from "./config.js";
import type { CallerSession } from "./session.js";

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

interface PostgrestError {
  readonly code?: string;
  readonly message?: string;
  readonly details?: string | null;
}

const sqlStateErrors: Readonly<Record<string, ProductErrorCode>> = {
  "23505": "CONFLICT",
  "23503": "VALIDATION",
  "23514": "VALIDATION",
  "23502": "VALIDATION",
  "22P02": "VALIDATION",
  "22023": "VALIDATION",
  "2201B": "VALIDATION",
  "42501": "FORBIDDEN",
  PGRST301: "AUTH_REQUIRED",
  PGRST302: "AUTH_REQUIRED",
};

/** Translates a PostgREST error body into the shared product error vocabulary. */
export function productErrorFromPostgrest(status: number, body: PostgrestError | undefined): ProductError {
  if (body?.code === "P0001" && isProductErrorCode(body.message))
    return new ProductError(body.message, body.details || undefined);
  const mapped = body?.code ? sqlStateErrors[body.code] : undefined;
  if (mapped) return new ProductError(mapped, body?.message);
  if (status === 401) return new ProductError("AUTH_REQUIRED");
  if (status >= 500) return new ProductError("UNAVAILABLE", "database layer unavailable");
  return new ProductError("INTERNAL_ERROR");
}

/** Calls the database functions through PostgREST so row security and grants run as the caller. */
export class PostgrestDatabaseGateway implements DatabaseGateway {
  constructor(
    private readonly config: ServiceConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  command(session: CallerSession, call: CommandCall): Promise<JsonObject> {
    return this.rpc<JsonObject>(
      "product_command",
      {
        p_workspace_id: call.workspaceId,
        p_operation: call.operation,
        p_idempotency_key: call.idempotencyKey,
        p_expected_head: call.expectedHead,
        p_payload: call.payload,
      },
      this.callerHeaders(session),
    );
  }

  read(session: CallerSession, call: ReadCall): Promise<unknown> {
    return this.rpc(
      "product_read",
      { p_workspace_id: call.workspaceId, p_operation: call.operation, p_payload: call.payload },
      this.callerHeaders(session),
    );
  }

  worker(operation: string, payload: JsonObject): Promise<JsonObject> {
    return this.rpc<JsonObject>(
      "product_worker",
      { p_operation: operation, p_payload: payload },
      { apikey: this.config.databaseSecretKey, authorization: `Bearer ${this.config.databaseSecretKey}` },
    );
  }

  private callerHeaders(session: CallerSession): Record<string, string> {
    const headers: Record<string, string> = {
      apikey: this.config.databasePublishableKey,
      authorization: `Bearer ${session.accessToken}`,
    };
    if (session.clientToken) headers[headerNames.clientToken] = session.clientToken;
    return headers;
  }

  private async rpc<T>(functionName: string, body: JsonObject, headers: Record<string, string>): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.databaseUrl}/rest/v1/rpc/${functionName}`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json", "content-profile": "api" },
        body: JSON.stringify(body),
      });
    } catch {
      throw new ProductError("UNAVAILABLE", "database layer unreachable");
    }
    const text = await response.text();
    const parsed: unknown = text ? JSON.parse(text) : null;
    if (!response.ok)
      throw productErrorFromPostgrest(response.status, (parsed ?? undefined) as PostgrestError | undefined);
    return parsed as T;
  }
}
