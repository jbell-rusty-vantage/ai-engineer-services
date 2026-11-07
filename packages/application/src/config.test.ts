import { describe, expect, it } from "vitest";
import { describeDatabaseTarget, loadServiceConfig, requiredEnvironment } from "./config.js";

const remote = {
  AIENG_DB_URL: "https://fakeprojectref.supabase.co",
  AIENG_DB_PUBLISHABLE_KEY: "fake-publishable",
  AIENG_DB_SECRET_KEY: "fake-secret",
  AIENG_DB_PROJECT_REF: "fakeprojectref",
};

describe("loadServiceConfig", () => {
  it("reads the AIENG_DB names and exposes only plane, ref and host for logging", () => {
    const config = loadServiceConfig(remote);
    expect(config.databaseUrl).toBe("https://fakeprojectref.supabase.co");
    expect(describeDatabaseTarget(config)).toEqual({
      plane: "AIENG",
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
    const lab = loadServiceConfig({ ...withoutRef, AIENG_DB_URL: "http://127.0.0.1:54321" });
    expect(lab.projectRef).toBeUndefined();
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
