import type { CommandCall, DatabaseGateway, ObjectStorage, ReadCall } from "@aiengineer/service-application";
import { ProductService } from "@aiengineer/service-application";
import { type JsonObject, ProductError } from "@aiengineer/service-contracts";
import { describe, expect, it } from "vitest";
import { buildApiServer } from "./server.js";

class EchoDatabase implements DatabaseGateway {
  last?: CommandCall | ReadCall;
  async command(_session: unknown, call: CommandCall): Promise<JsonObject> {
    this.last = call;
    if (call.payload.title === "forbidden") throw new ProductError("FORBIDDEN", "role reader");
    return { threadId: "t1", replayed: false };
  }
  async read(_session: unknown, call: ReadCall): Promise<unknown> {
    this.last = call;
    return [];
  }
  async worker(): Promise<JsonObject> {
    return { state: "available" };
  }
}

const storage: ObjectStorage = { put: async () => undefined, get: async () => new Uint8Array() };

function api(database = new EchoDatabase()) {
  return { database, app: buildApiServer({ service: new ProductService(database, storage) }) };
}

const command = { workspaceId: null, idempotencyKey: "key-12345", payload: { title: "Retry help", purpose: "tutor" } };

describe("API server", () => {
  it("publishes the public operation catalog", async () => {
    const response = await api().app.inject({ method: "GET", url: "/v1/operations" });
    const names = response.json().operations.map((operation: { name: string }) => operation.name);
    expect(names).toContain("search");
    expect(names).not.toContain("register_asset");
  });

  it("requires a bearer token", async () => {
    const response = await api().app.inject({ method: "POST", url: "/v1/commands/create_thread", payload: command });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("AUTH_REQUIRED");
  });

  it("runs a command as the caller", async () => {
    const { app, database } = api();
    const response = await app.inject({
      method: "POST",
      url: "/v1/commands/create_thread",
      headers: { authorization: "Bearer user" },
      payload: command,
    });
    expect(response.statusCode).toBe(200);
    expect(database.last?.operation).toBe("create_thread");
  });

  it("maps database errors to HTTP statuses", async () => {
    const response = await api().app.inject({
      method: "POST",
      url: "/v1/commands/create_thread",
      headers: { authorization: "Bearer user" },
      payload: { ...command, payload: { title: "forbidden", purpose: "tutor" } },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ code: "FORBIDDEN", message: "FORBIDDEN", detail: "role reader" });
  });

  it("rejects unknown operations and malformed bodies", async () => {
    const headers = { authorization: "Bearer user" };
    expect(
      (await api().app.inject({ method: "POST", url: "/v1/commands/register_asset", headers, payload: command }))
        .statusCode,
    ).toBe(404);
    expect(
      (await api().app.inject({ method: "POST", url: "/v1/reads/search", headers, payload: { payload: {} } }))
        .statusCode,
    ).toBe(422);
  });

  it("requires asset metadata for uploads", async () => {
    const response = await api().app.inject({
      method: "POST",
      url: "/v1/assets",
      headers: { authorization: "Bearer user", "content-type": "application/octet-stream" },
      payload: Buffer.from("bytes"),
    });
    expect(response.statusCode).toBe(422);
  });
});
