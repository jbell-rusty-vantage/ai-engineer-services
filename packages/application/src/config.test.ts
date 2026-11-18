import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { describeDatabaseTarget, isLoopbackHost, loadServiceConfig, requiredEnvironment } from "./config.js";

const remote = {
  AIENG_DB_URL: "https://fakeprojectref.supabase.co",
  AIENG_DB_PUBLISHABLE_KEY: "fake-publishable",
  AIENG_DB_SECRET_KEY: "fake-secret",
  AIENG_DB_PROJECT_REF: "fakeprojectref",
  AIENG_DB_REMOTE_CONFIRM: "fakeprojectref",
};

const lab = {
  AIENG_DB_URL: "http://127.0.0.1:55621",
  AIENG_DB_PUBLISHABLE_KEY: "fake-publishable",
  AIENG_DB_SECRET_KEY: "fake-secret",
};

describe("loadServiceConfig", () => {
  it("reads the AIENG_DB names and exposes only plane, ref and host for logging", () => {
    const config = loadServiceConfig(remote);
    expect(config.databaseUrl).toBe("https://fakeprojectref.supabase.co");
    expect(describeDatabaseTarget(config)).toEqual({
      plane: "AIENG",
      location: "remote",
      projectRef: "fakeprojectref",
      host: "fakeprojectref.supabase.co",
    });
    expect(JSON.stringify(describeDatabaseTarget(config))).not.toContain("fake-secret");
  });

  it("refuses a project ref that does not appear in the URL host", () => {
    expect(() => loadServiceConfig({ ...remote, AIENG_DB_PROJECT_REF: "otherprojectref" })).toThrow(
      "AIENG_DB_PROJECT_REF_MISMATCH",
    );
  });

  it("requires a project ref for a non-loopback URL but not for a loopback lab stack", () => {
    const { AIENG_DB_PROJECT_REF: _ref, ...withoutRef } = remote;
    expect(() => loadServiceConfig(withoutRef)).toThrow("MISSING_ENVIRONMENT: AIENG_DB_PROJECT_REF");
    const loopback = loadServiceConfig({ ...withoutRef, AIENG_DB_URL: "http://127.0.0.1:54321" });
    expect(loopback.projectRef).toBeUndefined();
  });

  it("is local by default: the loopback lab needs no ref and no confirmation", () => {
    const config = loadServiceConfig(lab);
    expect(config.projectRef).toBeUndefined();
    expect(describeDatabaseTarget(config)).toMatchObject({ location: "local", host: "127.0.0.1" });
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("fakeprojectref.supabase.co")).toBe(false);
  });

  it("refuses an unconfigured start and names the lab file", () => {
    expect(() => loadServiceConfig({})).toThrow(/MISSING_ENVIRONMENT: AIENG_DB_URL \(.*\.env\.lab/);
  });

  it("refuses a remote database unless AIENG_DB_REMOTE_CONFIRM names its project ref", () => {
    const { AIENG_DB_REMOTE_CONFIRM: _confirm, ...unconfirmed } = remote;
    expect(() => loadServiceConfig(unconfirmed)).toThrow("REMOTE_DATABASE_NOT_CONFIRMED");
    expect(() => loadServiceConfig({ ...remote, AIENG_DB_REMOTE_CONFIRM: "otherprojectref" })).toThrow(
      "REMOTE_DATABASE_NOT_CONFIRMED",
    );
    expect(() => loadServiceConfig({ ...remote, AIENG_DB_REMOTE_CONFIRM: "" })).toThrow(
      "REMOTE_DATABASE_NOT_CONFIRMED",
    );
    expect(loadServiceConfig(remote).projectRef).toBe("fakeprojectref");
  });

  it("does not read the previous AIENG_SUPABASE names", () => {
    expect(() =>
      loadServiceConfig({
        AIENG_SUPABASE_URL: remote.AIENG_DB_URL,
        AIENG_SUPABASE_ANON_KEY: "x",
        AIENG_SUPABASE_SERVICE_ROLE_KEY: "y",
      }),
    ).toThrow("MISSING_ENVIRONMENT: AIENG_DB_URL");
  });

  it("names the missing variable and trims values", () => {
    expect(() => requiredEnvironment({}, "AIENG_DB_SECRET_KEY")).toThrow("MISSING_ENVIRONMENT: AIENG_DB_SECRET_KEY");
    expect(requiredEnvironment({ A: " v " }, "A")).toBe("v");
  });
});

describe("local by default: the scripts", () => {
  const manifests = ["../../../package.json", "../../../apps/api/package.json", "../../../apps/mcp/package.json"];

  it("load only the lab file, never the repository .env that holds the remote values", () => {
    const envFiles: string[] = [];
    for (const manifest of manifests) {
      const { scripts } = JSON.parse(readFileSync(new URL(manifest, import.meta.url), "utf8")) as {
        scripts: Record<string, string>;
      };
      for (const command of Object.values(scripts)) {
        for (const match of command.matchAll(/--env-file(?:-if-exists)?=(\S+)/g)) envFiles.push(match[1] as string);
      }
    }
    expect(envFiles.length).toBeGreaterThanOrEqual(6);
    for (const file of envFiles) expect(file).toMatch(/(^|\/)\.env\.lab$/);
  });
});
