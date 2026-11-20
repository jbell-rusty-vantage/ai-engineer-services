import {
  headerNames,
  isProductErrorCode,
  type JsonObject,
  ProductError,
  type ProductErrorCode,
} from "@aiengineer/service-contracts";
import type { ServiceConfig } from "./config.js";
import type { CallerSession } from "./session.js";

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
  // The database does not have (or does not expose) the function, relation or schema this service reads.
  "42883": "NOT_AVAILABLE",
  "42P01": "NOT_AVAILABLE",
  PGRST106: "NOT_AVAILABLE",
  PGRST202: "NOT_AVAILABLE",
  PGRST205: "NOT_AVAILABLE",
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

type Headers = Record<string, string>;

/** PostgREST requests against the `api` schema of the configured project. */
export class PostgrestTransport {
  constructor(
    private readonly config: ServiceConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** The caller's own session, so grants and row security apply to them. */
  callerHeaders(session: CallerSession): Headers {
    const headers: Headers = {
      apikey: this.config.databasePublishableKey,
      authorization: `Bearer ${session.accessToken}`,
    };
    if (session.clientToken) headers[headerNames.clientToken] = session.clientToken;
    return headers;
  }

  /** The service key; used for byte custody, worker calls and the release read at startup only. */
  serviceHeaders(): Headers {
    return { apikey: this.config.databaseSecretKey, authorization: `Bearer ${this.config.databaseSecretKey}` };
  }

  /** Calls a function with named arguments; `signal` puts a time limit on the call (the release read at startup). */
  rpc<T>(functionName: string, body: JsonObject, headers: Headers, signal?: AbortSignal): Promise<T> {
    return this.send<T>(`/rest/v1/rpc/${functionName}`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json", "content-profile": "api" },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  }

  /** Reads rows of a table or view; `query` carries PostgREST `select`, filters, `order` and `limit`. */
  select<T>(relation: string, query: URLSearchParams, headers: Headers): Promise<T[]> {
    return this.send<T[]>(`/rest/v1/${relation}?${query.toString()}`, {
      method: "GET",
      headers: { ...headers, "accept-profile": "api" },
    });
  }

  private async send<T>(
    path: string,
    init: { method: string; headers: Headers; body?: string; signal?: AbortSignal },
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.databaseUrl}${path}`, init);
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
