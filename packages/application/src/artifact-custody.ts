import { createHash } from "node:crypto";
import { ProductError } from "@aiengineer/service-contracts";
import type { DatabaseGateway } from "./database-gateway.js";
import type { ObjectStorage } from "./object-storage.js";

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface PendingArtifact {
  readonly artifactId: string;
  readonly objectPath: string;
}

/**
 * Moves a registered (pending) artifact to `available`: store the bytes, read them back, hash what storage returned
 * and let the database compare it with the registered digest. A mismatch leaves the artifact pending for re-upload.
 */
export class ArtifactCustody {
  constructor(
    private readonly database: DatabaseGateway,
    private readonly storage: ObjectStorage,
  ) {}

  async storeAndVerify(artifact: PendingArtifact, bytes: Uint8Array, mediaType: string): Promise<void> {
    await this.storage.put(artifact.objectPath, bytes, mediaType);
    const readBack = await this.storage.get(artifact.objectPath);
    const completion = await this.database.worker("complete_asset", {
      artifact_id: artifact.artifactId,
      verified_sha256: sha256Hex(readBack),
    });
    if (completion.state !== "available")
      throw new ProductError("DIGEST_MISMATCH", "stored bytes do not match the registered digest");
  }
}
