import {
  checkDatabaseRelease,
  type DatabaseGateway,
  type DatabaseReleaseCheckMode,
  DatabaseReleaseRefused,
  databaseReleaseFormat,
  type ObjectStorage,
  ProductService,
} from "@aiengineer/service-application";
import type { JsonObject } from "@aiengineer/service-contracts";
import { describe, expect, it } from "vitest";
import { buildRemoteMcpHost } from "./remote-host.js";

function stated(release: string | null, state: string) {
  return { format: databaseReleaseFormat, release, state };
}

/** The database port of a remote host that serves no operation in these tests; it only states its release. */
class StatingDatabase implements DatabaseGateway {
  releaseAsked = 0;
  constructor(private readonly release: unknown = stated("1.5.0", "current")) {}
  async command(): Promise<JsonObject> {
    return {};
  }
  async read(): Promise<unknown> {
    return [];
  }
  async scope(): Promise<JsonObject> {
    return {};
  }
  async worker(): Promise<JsonObject> {
    return {};
  }
  async databaseRelease(): Promise<unknown> {
    this.releaseAsked += 1;
    return this.release;
  }
}

const storage: ObjectStorage = { put: async () => undefined, get: async () => new Uint8Array() };

/** A fixture range; the range the service really states (the pinned contract) is tested in packages/application. */
const releaseRange = ">=1.2.0 <2.0.0";
const checkedAt = "2026-11-20T00:00:00.000Z";

function host(database: StatingDatabase, mode: DatabaseReleaseCheckMode = "enforce") {
  return buildRemoteMcpHost({
    service: new ProductService(database, storage),
    databaseRelease: () =>
      checkDatabaseRelease(database, { mode, range: releaseRange, log: false, now: () => new Date(checkedAt) }),
  });
}

describe("remote MCP host: database release check", () => {
  const health = { method: "GET", url: "/health" } as const;

  it("asks the database once when the host starts and reports its release on /health", async () => {
    const database = new StatingDatabase();
    const app = host(database);
    const response = await app.inject(health);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      databaseRelease: {
        mode: "enforce",
        range: releaseRange,
        release: "1.5.0",
        state: "current",
        verdict: "ok",
        warning: false,
        checkedAt,
      },
    });
    const unauthenticated = await app.inject({ method: "POST", url: "/mcp", payload: {} });
    expect(unauthenticated.statusCode).toBe(401);
    expect(database.releaseAsked).toBe(1);
  });

  it("refuses to start on a release outside its range, with one error, and never listens", async () => {
    const app = host(new StatingDatabase(stated("2.0.0", "current")));
    const refusal = await app.listen({ host: "127.0.0.1", port: 0 }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(refusal).toBeInstanceOf(DatabaseReleaseRefused);
    expect((refusal as DatabaseReleaseRefused).message).toContain(
      "Database release: 2.0.0; state: current; this service works with: >=1.2.0 <2.0.0. AIENG_DB_RELEASE_CHECK=warn",
    );
    expect(app.server.listening).toBe(false);
    await app.close();
  });

  it("refuses a database that states no release", async () => {
    await expect(host(new StatingDatabase(null)).ready()).rejects.toMatchObject({
      code: "AIENG_DB_RELEASE_REFUSED",
      report: { verdict: "unknown" },
    });
  });

  it("starts in warn mode on the same database, and does not ask in off mode", async () => {
    const warned = await host(new StatingDatabase(stated("2.0.0", "current")), "warn").inject(health);
    expect(warned.json().databaseRelease).toMatchObject({ mode: "warn", verdict: "incompatible", release: "2.0.0" });
    const database = new StatingDatabase();
    const skipped = await host(database, "off").inject(health);
    expect(skipped.json().databaseRelease).toMatchObject({ mode: "off", verdict: "not_checked", release: null });
    expect(database.releaseAsked).toBe(0);
  });
});
