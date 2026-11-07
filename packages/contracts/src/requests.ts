import { z } from "zod";

/** Body of `POST /v1/commands/:operation`. */
export const commandRequest = z.strictObject({
  workspaceId: z.guid().nullable(),
  idempotencyKey: z.string().min(8).max(200),
  expectedHead: z.guid().nullable().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type CommandRequest = z.infer<typeof commandRequest>;

/** Body of `POST /v1/reads/:operation`. */
export const readRequest = z.strictObject({
  workspaceId: z.guid().nullable().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type ReadRequest = z.infer<typeof readRequest>;

export const artifactTypes = [
  "authored_work_asset",
  "uploaded_document",
  "experience_bundle",
  "project_bundle",
  "course_source_capture",
] as const;
export const assetUsages = ["reference_only", "private_copy", "redistributable", "unknown"] as const;

/** Metadata of `POST /v1/assets`; the raw bytes travel as the request body. */
export const assetUploadMetadata = z.strictObject({
  workspaceId: z.guid(),
  artifactType: z.enum(artifactTypes),
  mediaType: z.string().min(1).max(200),
  usage: z.enum(assetUsages),
  rightsBasis: z.string().trim().min(1).max(2000),
  retention: z.enum(["durable", "temporary"]).default("durable"),
});
export type AssetUploadMetadata = z.infer<typeof assetUploadMetadata>;

export interface AssetUploadResult {
  readonly artifactId: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

/** Maximum object size accepted in this release (matches the database limit). */
export const maxAssetBytes = 25 * 1024 * 1024;

/** Request headers shared by every surface. */
export const headerNames = {
  clientToken: "x-aieng-client-token",
  assetMetadata: "x-aieng-asset",
} as const;
