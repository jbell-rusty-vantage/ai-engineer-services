import { randomUUID } from "node:crypto";
import {
  type AssetUploadInput,
  type AssetUploadResult,
  type CommandInput,
  headerNames,
  isProductErrorCode,
  type JsonObject,
  ProductError,
  type ProductPort,
  type ReadInput,
} from "@aiengineer/service-contracts";

export interface ClientOptions {
  /** API origin, e.g. `http://127.0.0.1:3200`. */
  readonly baseUrl: string;
  /** The user's access token (Supabase Auth session). */
  readonly accessToken: string;
  /** Optional scoped client grant token minted with `create_client_grant`. */
  readonly clientToken?: string;
  readonly fetch?: typeof fetch;
}

export interface CatalogEntry {
  readonly name: string;
  readonly kind: "command" | "read";
  readonly scope: string;
  readonly summary: string;
}

/** Typed HTTP client for the AI Engineer product API; used by the CLI, the local MCP server and the web app. */
export class AiEngineerClient implements ProductPort {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? fetch;
  }

  command(operation: string, input: CommandInput): Promise<JsonObject> {
    return this.post<JsonObject>(`/v1/commands/${encodeURIComponent(operation)}`, {
      workspaceId: input.workspaceId,
      idempotencyKey: input.idempotencyKey ?? `cli-${randomUUID()}`,
      expectedHead: input.expectedHead ?? null,
      payload: input.payload,
    });
  }

  read(operation: string, input: ReadInput): Promise<unknown> {
    return this.post(`/v1/reads/${encodeURIComponent(operation)}`, {
      workspaceId: input.workspaceId ?? null,
      payload: input.payload,
    });
  }

  uploadAsset(metadata: AssetUploadInput, bytes: Uint8Array): Promise<AssetUploadResult> {
    return this.send<AssetUploadResult>("/v1/assets", {
      method: "POST",
      headers: { "content-type": "application/octet-stream", [headerNames.assetMetadata]: JSON.stringify(metadata) },
      body: bytes,
    });
  }

  async operations(): Promise<CatalogEntry[]> {
    const body = await this.send<{ operations: CatalogEntry[] }>("/v1/operations", { method: "GET" });
    return body.operations;
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.send<T>(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  private async send<T>(
    path: string,
    init: { method: string; headers?: Record<string, string>; body?: string | Uint8Array },
  ): Promise<T> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.options.accessToken}`, ...init.headers };
    if (this.options.clientToken) headers[headerNames.clientToken] = this.options.clientToken;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: init.method,
        headers,
        ...(init.body ? { body: init.body } : {}),
      });
    } catch {
      throw new ProductError("UNAVAILABLE", "AI Engineer API unreachable");
    }
    const text = await response.text();
    const parsed: unknown = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const body = parsed as { code?: unknown; detail?: string } | null;
      throw new ProductError(isProductErrorCode(body?.code) ? body.code : "INTERNAL_ERROR", body?.detail);
    }
    return parsed as T;
  }
}
