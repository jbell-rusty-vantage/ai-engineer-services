import { ProductError } from "@aiengineer/service-contracts";
import type { ServiceConfig } from "./config.js";

export const workspaceBucket = "aieng-workspaces";

/** Server-side byte custody for the private product bucket. Clients never receive storage credentials. */
export interface ObjectStorage {
  /** Stores bytes at a path; an existing object is left untouched (the read-back decides whether it matches). */
  put(path: string, bytes: Uint8Array, mediaType: string): Promise<void>;
  get(path: string): Promise<Uint8Array>;
}

export class SupabaseObjectStorage implements ObjectStorage {
  constructor(
    private readonly config: ServiceConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async put(path: string, bytes: Uint8Array, mediaType: string): Promise<void> {
    const response = await this.request(`/storage/v1/object/${workspaceBucket}/${path}`, {
      method: "POST",
      headers: { "content-type": mediaType, "x-upsert": "false" },
      body: bytes,
    });
    if (!response.ok && response.status !== 409 && !(await isDuplicate(response))) {
      throw new ProductError("UNAVAILABLE", `storage write failed (${response.status})`);
    }
  }

  async get(path: string): Promise<Uint8Array> {
    const response = await this.request(`/storage/v1/object/authenticated/${workspaceBucket}/${path}`, {
      method: "GET",
    });
    if (!response.ok) throw new ProductError("STORAGE_OBJECT_MISSING", `storage read failed (${response.status})`);
    return new Uint8Array(await response.arrayBuffer());
  }

  private request(
    path: string,
    init: { method: string; headers?: Record<string, string>; body?: Uint8Array },
  ): Promise<Response> {
    const key = this.config.databaseSecretKey;
    return this.fetchImpl(`${this.config.databaseUrl}${path}`, {
      method: init.method,
      headers: { apikey: key, authorization: `Bearer ${key}`, ...init.headers },
      ...(init.body ? { body: init.body } : {}),
    });
  }
}

async function isDuplicate(response: Response): Promise<boolean> {
  const body = (await response.json().catch(() => undefined)) as { statusCode?: string } | undefined;
  return body?.statusCode === "409";
}
