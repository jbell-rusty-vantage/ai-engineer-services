import type { AssetUploadResult } from "./requests.js";

export type JsonObject = Record<string, unknown>;

export interface CommandInput {
  readonly workspaceId: string | null;
  readonly payload: JsonObject;
  readonly expectedHead?: string | null;
  readonly idempotencyKey?: string;
}

export interface ReadInput {
  readonly workspaceId?: string | null;
  readonly payload: JsonObject;
}

export interface AssetUploadInput {
  readonly workspaceId: string;
  readonly artifactType:
    | "authored_work_asset"
    | "uploaded_document"
    | "experience_bundle"
    | "project_bundle"
    | "course_source_capture";
  readonly mediaType: string;
  readonly usage: "reference_only" | "private_copy" | "redistributable" | "unknown";
  readonly rightsBasis: string;
  readonly retention?: "durable" | "temporary";
}

/**
 * The product operations one authenticated caller can perform. Implemented in process by the application (API and
 * remote MCP) and over HTTP by the client (CLI and local MCP), so tools are written once against this port.
 */
export interface ProductPort {
  command(operation: string, input: CommandInput): Promise<JsonObject>;
  read(operation: string, input: ReadInput): Promise<unknown>;
  uploadAsset(metadata: AssetUploadInput, bytes: Uint8Array): Promise<AssetUploadResult>;
}
