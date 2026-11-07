import { createHash } from "node:crypto";
import { type JsonObject, ProductError } from "@aiengineer/service-contracts";
import { describe, expect, it } from "vitest";
import type { CommandCall, DatabaseGateway, ReadCall } from "./database-gateway.js";
import { productErrorFromPostgrest } from "./database-gateway.js";
import type { ObjectStorage } from "./object-storage.js";
import { ProductService } from "./product-service.js";

const session = { accessToken: "user-token" };

class FakeDatabase implements DatabaseGateway {
  readonly commands: CommandCall[] = [];
  readonly workerCalls: { operation: string; payload: JsonObject }[] = [];
  registeredSha = "";

  async command(_session: unknown, call: CommandCall): Promise<JsonObject> {
    this.commands.push(call);
    if (call.operation === "register_asset") {
      this.registeredSha = String(call.payload.sha256);
      return { artifactId: "a1", objectPath: "t/w/a1/sha" };
    }
    if (call.operation === "freeze_release")
      return { releaseId: "r1", manifestArtifactId: "m1", objectPath: "t/w/m1/sha", manifestText: "{}" };
    return { ok: true };
  }

  async read(_session: unknown, call: ReadCall): Promise<unknown> {
    return call.operation === "get_thread" ? null : { ok: true };
  }

  async worker(operation: string, payload: JsonObject): Promise<JsonObject> {
    this.workerCalls.push({ operation, payload });
    return {
      state: payload.verified_sha256 === this.registeredSha || payload.artifact_id === "m1" ? "available" : "pending",
    };
  }
}

class MemoryStorage implements ObjectStorage {
  readonly objects = new Map<string, Uint8Array>();
  constructor(private readonly corrupt = false) {}
  async put(path: string, bytes: Uint8Array): Promise<void> {
    this.objects.set(path, this.corrupt ? new Uint8Array([0]) : bytes);
  }
  async get(path: string): Promise<Uint8Array> {
    const bytes = this.objects.get(path);
    if (!bytes) throw new ProductError("STORAGE_OBJECT_MISSING");
    return bytes;
  }
}

const metadata = {
  workspaceId: "0193e3c1-6f5a-7c3e-9a1b-2c3d4e5f6a7b",
  artifactType: "authored_work_asset",
  mediaType: "text/plain",
  usage: "redistributable",
  rightsBasis: "authored",
} as const;

describe("ProductService", () => {
  it("rejects operations outside the public catalog", async () => {
    const service = new ProductService(new FakeDatabase(), new MemoryStorage());
    await expect(
      service.runCommand(session, "register_asset", { workspaceId: null, payload: {} }),
    ).rejects.toMatchObject({ code: "UNKNOWN_OPERATION" });
    await expect(
      service.runCommand(session, "drop_everything", { workspaceId: null, payload: {} }),
    ).rejects.toMatchObject({ code: "UNKNOWN_OPERATION" });
  });

  it("validates payloads at the edge", async () => {
    const service = new ProductService(new FakeDatabase(), new MemoryStorage());
    await expect(service.runRead(session, "search", { payload: {} })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("maps an empty read to NOT_FOUND", async () => {
    const service = new ProductService(new FakeDatabase(), new MemoryStorage());
    await expect(
      service.runRead(session, "get_thread", { payload: { thread_id: "0193e3c1-6f5a-7c3e-9a1b-2c3d4e5f6a7b" } }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("uploads, reads back and verifies an asset", async () => {
    const database = new FakeDatabase();
    const service = new ProductService(database, new MemoryStorage());
    const bytes = new TextEncoder().encode("hello");
    const result = await service.uploadAsset(session, metadata, bytes);
    expect(result.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(database.workerCalls[0]?.operation).toBe("complete_asset");
  });

  it("reports corrupted storage as a digest mismatch", async () => {
    const service = new ProductService(new FakeDatabase(), new MemoryStorage(true));
    await expect(service.uploadAsset(session, metadata, new TextEncoder().encode("hello"))).rejects.toMatchObject({
      code: "DIGEST_MISMATCH",
    });
  });

  it("stores the release manifest before returning", async () => {
    const storage = new MemoryStorage();
    const service = new ProductService(new FakeDatabase(), storage);
    await service.runCommand(session, "freeze_release", {
      workspaceId: "0193e3c1-6f5a-7c3e-9a1b-2c3d4e5f6a7b",
      payload: {
        root_revision_id: "0193e3c1-6f5a-7c3e-9a1b-2c3d4e5f6a7b",
        ceiling: "named",
        approval_event_id: "0193e3c1-6f5a-7c3e-9a1b-2c3d4e5f6a7b",
      },
    });
    expect(storage.objects.has("t/w/m1/sha")).toBe(true);
  });
});

describe("productErrorFromPostgrest", () => {
  it("keeps product codes raised by the database", () => {
    expect(
      productErrorFromPostgrest(400, { code: "P0001", message: "NOT_FOUND", details: "workspace" }).toBody(),
    ).toEqual({ code: "NOT_FOUND", message: "NOT_FOUND", detail: "workspace" });
  });

  it("maps constraint violations", () => {
    expect(productErrorFromPostgrest(409, { code: "23505", message: "duplicate key" }).code).toBe("CONFLICT");
    expect(productErrorFromPostgrest(400, { code: "23514", message: "check" }).code).toBe("VALIDATION");
  });
});
