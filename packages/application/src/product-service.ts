import { randomUUID } from "node:crypto";
import {
  type AssetUploadInput,
  type AssetUploadResult,
  assetUploadMetadata,
  type CommandInput,
  findOperation,
  type JsonObject,
  maxAssetBytes,
  type OperationDefinition,
  type OperationKind,
  ProductError,
  type ReadInput,
} from "@aiengineer/service-contracts";
import { ArtifactCustody, sha256Hex } from "./artifact-custody.js";
import type { DatabaseGateway } from "./database-gateway.js";
import type { ObjectStorage } from "./object-storage.js";
import type { CallerSession } from "./session.js";

/** Operations whose result carries a platform-generated manifest the server must store before returning. */
const manifestProducingOperations = new Set(["freeze_release", "submit_attempt"]);

function publicOperation(name: string, kind: OperationKind): OperationDefinition {
  const definition = findOperation(name, kind);
  if (definition?.exposure !== "public") throw new ProductError("UNKNOWN_OPERATION", name);
  return definition;
}

function parsePayload(definition: OperationDefinition, payload: JsonObject): JsonObject {
  const parsed = definition.payload.safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ProductError(
      "VALIDATION",
      issue ? `${issue.path.join(".") || "payload"}: ${issue.message}` : "invalid payload",
    );
  }
  return parsed.data as JsonObject;
}

/** Product use cases shared by every transport (HTTP API, remote MCP, and through the client the CLI/local MCP). */
export class ProductService {
  private readonly custody: ArtifactCustody;

  constructor(
    private readonly database: DatabaseGateway,
    storage: ObjectStorage,
  ) {
    this.custody = new ArtifactCustody(database, storage);
  }

  async runCommand(session: CallerSession, operation: string, input: CommandInput): Promise<JsonObject> {
    const definition = publicOperation(operation, "command");
    const result = await this.database.command(session, {
      workspaceId: input.workspaceId,
      operation: definition.name,
      idempotencyKey: input.idempotencyKey ?? `cmd-${randomUUID()}`,
      expectedHead: input.expectedHead ?? null,
      payload: parsePayload(definition, input.payload),
    });
    if (manifestProducingOperations.has(definition.name) && result.replayed !== true) await this.storeManifest(result);
    return result;
  }

  async runRead(session: CallerSession, operation: string, input: ReadInput): Promise<unknown> {
    const definition = publicOperation(operation, "read");
    const result = await this.database.read(session, {
      workspaceId: input.workspaceId ?? null,
      operation: definition.name,
      payload: parsePayload(definition, input.payload),
    });
    if (result === null) throw new ProductError("NOT_FOUND", definition.name);
    return result;
  }

  /** Registers, stores and verifies one file; the caller's database permissions authorize the registration. */
  async uploadAsset(session: CallerSession, metadata: AssetUploadInput, bytes: Uint8Array): Promise<AssetUploadResult> {
    const parsed = assetUploadMetadata.safeParse(metadata);
    if (!parsed.success)
      throw new ProductError("VALIDATION", parsed.error.issues[0]?.message ?? "invalid asset metadata");
    if (bytes.byteLength > maxAssetBytes) throw new ProductError("LIMIT_EXCEEDED", "25 MiB per object");
    const sha256 = sha256Hex(bytes);
    const registration = await this.database.command(session, {
      workspaceId: parsed.data.workspaceId,
      operation: "register_asset",
      idempotencyKey: `upload-${randomUUID()}`,
      expectedHead: null,
      payload: {
        artifact_type: parsed.data.artifactType,
        sha256,
        size_bytes: bytes.byteLength,
        media_type: parsed.data.mediaType,
        usage: parsed.data.usage,
        rights_basis: parsed.data.rightsBasis,
        retention: parsed.data.retention,
      },
    });
    const artifactId = String(registration.artifactId);
    await this.custody.storeAndVerify(
      { artifactId, objectPath: String(registration.objectPath) },
      bytes,
      parsed.data.mediaType,
    );
    return { artifactId, sha256, sizeBytes: bytes.byteLength };
  }

  private async storeManifest(result: JsonObject): Promise<void> {
    const { manifestArtifactId, objectPath, manifestText } = result;
    if (typeof manifestArtifactId !== "string" || typeof objectPath !== "string" || typeof manifestText !== "string") {
      throw new ProductError("INTERNAL_ERROR", "manifest missing from result");
    }
    await this.custody.storeAndVerify(
      { artifactId: manifestArtifactId, objectPath },
      new TextEncoder().encode(manifestText),
      "application/json",
    );
  }
}
