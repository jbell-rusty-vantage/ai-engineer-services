import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ProductError } from "@aiengineer/service-contracts";
import { describe, expect, it } from "vitest";
import { checkMode, databaseReleaseCheckModes, databaseReleaseCheckName } from "./config.js";
import type { DatabaseGateway } from "./database-gateway.js";
import {
  checkDatabaseRelease,
  compareVersions,
  DatabaseReleaseRefused,
  type DatabaseReleaseReport,
  databaseReleaseFormat,
  databaseReleaseStatus,
  inRange,
  releaseVerdict,
} from "./database-release.js";
import { databaseContractPackage, pinnedContract, serviceReleaseRange } from "./pinned-contract.js";

interface SharedCases {
  readonly format: string;
  readonly range: readonly { readonly version: string; readonly range: string; readonly in: boolean }[];
  readonly verdict: readonly {
    readonly name: string;
    readonly observed: unknown;
    readonly range: string;
    readonly verdict: string;
    readonly start: boolean;
    readonly warning: boolean;
  }[];
  readonly mode: { readonly variable: string; readonly values: Readonly<Record<string, string>> };
}

const readJson = (path: string | URL): unknown => JSON.parse(readFileSync(path, "utf8"));

// The cases every consumer of the AI Engineer database runs (VER-S1), read from the pinned contract package.
const pinned = pinnedContract();
const cases = readJson(join(pinned.packageRoot, "release-check.cases.json")) as SharedCases;

const now = () => new Date("2026-11-20T00:00:00.000Z");
const stated = (release: string | null, state: string) => ({ format: databaseReleaseFormat, release, state });

/** The database port as the check sees it: it states `answer`, or rejects when `answer` is an error. */
class StatedRelease implements Pick<DatabaseGateway, "databaseRelease"> {
  asked = 0;
  constructor(private readonly answer: unknown) {}
  async databaseRelease(): Promise<unknown> {
    this.asked += 1;
    if (this.answer instanceof Error) throw this.answer;
    return this.answer;
  }
}

/** A release the pinned range does not hold: the patch after it. */
function anotherRelease(): string {
  const [major, minor, patch] = serviceReleaseRange().split(".").map(Number);
  return `${major}.${minor}.${(patch ?? 0) + 1}`;
}

describe("the shared release-check cases of the pinned contract", () => {
  it("are the format this port was written against, and none is empty", () => {
    expect(cases.format).toBe("ai-engineer-release-check-cases/1");
    expect(cases.range.length).toBeGreaterThan(0);
    expect(cases.verdict.length).toBeGreaterThan(0);
  });

  it.each(cases.range)("inRange($version, $range) is $in", (item) => {
    expect(inRange(item.version, item.range)).toBe(item.in);
  });

  it.each(cases.verdict)("verdict: $name", (item) => {
    expect(releaseVerdict(item.observed, item.range)).toMatchObject({
      verdict: item.verdict,
      start: item.start,
      warning: item.warning,
      range: item.range,
    });
  });

  it("name the mode variable and exactly the modes this service accepts", () => {
    expect(cases.mode.variable).toBe(databaseReleaseCheckName);
    expect(Object.keys(cases.mode.values).sort()).toEqual([...databaseReleaseCheckModes].sort());
    for (const mode of Object.keys(cases.mode.values))
      expect(checkMode({ [databaseReleaseCheckName]: mode })).toBe(mode);
  });
});

describe("the rule", () => {
  it("compares versions numerically and refuses what is not a version or a range", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("0.9.0", "0.10.0")).toBe(-1);
    expect(() => inRange("1.2", "1.2.0")).toThrow("not a release version: 1.2");
    expect(() => inRange("1.2.0", "^1.2.0")).toThrow("not a release range: ^1.2.0");
  });

  it("carries the stated release and state in every verdict, and says why", () => {
    expect(releaseVerdict(stated("1.1.9", "current"), ">=1.2.0 <2.0.0")).toEqual({
      verdict: "incompatible",
      start: false,
      warning: false,
      range: ">=1.2.0 <2.0.0",
      release: "1.1.9",
      state: "current",
      reason: "the database is release 1.1.9; this service works with >=1.2.0 <2.0.0",
    });
    expect(releaseVerdict(stated("1.5.0", "ahead"), ">=1.2.0 <2.0.0").reason).toBe(
      "the database is release 1.5.0; migrations were applied after the stamp (unreleased changes)",
    );
    expect(releaseVerdict(stated("1.5.0", "a_new_word"), ">=1.2.0 <2.0.0")).toMatchObject({
      verdict: "ok",
      warning: true,
      reason: "the database is release 1.5.0; state a_new_word",
    });
    expect(releaseVerdict("not an object", "1.2.0")).toMatchObject({ verdict: "unknown", release: null, state: null });
  });
});

describe("the pinned contract", () => {
  const manifest = readJson(new URL("../package.json", import.meta.url)) as { dependencies: Record<string, string> };

  it("is a tarball vendored in this repository, so an install needs no sibling checkout", () => {
    const reference = manifest.dependencies[databaseContractPackage] ?? "";
    expect(reference).toMatch(/^file:\.\.\/\.\.\/vendor\/[^/]+\.tgz$/);
    expect(existsSync(new URL(`../${reference.slice("file:".length)}`, import.meta.url))).toBe(true);
    expect((readJson(join(pinned.packageRoot, "package.json")) as { name: string }).name).toBe(databaseContractPackage);
  });

  it("gives the service its range: the version in the package's contract.version.json", () => {
    const record = readJson(join(pinned.packageRoot, "contract.version.json")) as {
      version: string;
      migration_head: string;
    };
    expect(serviceReleaseRange()).toBe(record.version);
    expect(pinned).toMatchObject({ version: record.version, migrationHead: record.migration_head });
    expect(inRange(record.version, serviceReleaseRange())).toBe(true);
    expect(existsSync(join(pinned.packageRoot, "releases", `${record.version}.json`))).toBe(true);
  });
});

describe("checkDatabaseRelease", () => {
  it("starts on the release the service was built for and reports it", async () => {
    const logged: DatabaseReleaseReport[] = [];
    const database = new StatedRelease(stated(serviceReleaseRange(), "current"));
    const report = await checkDatabaseRelease(database, { mode: "enforce", now, log: (line) => logged.push(line) });
    expect(report).toEqual({
      mode: "enforce",
      range: pinned.version,
      release: pinned.version,
      state: "current",
      verdict: "ok",
      warning: false,
      reason: `the database is release ${pinned.version}`,
      checkedAt: "2026-11-20T00:00:00.000Z",
    });
    expect(logged).toEqual([report]);
    expect(database.asked).toBe(1);
  });

  it("refuses another release in enforce mode with one error that names the release, the range, the state and the variable", async () => {
    const logged: DatabaseReleaseReport[] = [];
    const other = anotherRelease();
    const refusal = await checkDatabaseRelease(new StatedRelease(stated(other, "current")), {
      mode: "enforce",
      now,
      log: (line) => logged.push(line),
    }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(refusal).toBeInstanceOf(DatabaseReleaseRefused);
    const refused = refusal as DatabaseReleaseRefused;
    expect(refused.code).toBe("AIENG_DB_RELEASE_REFUSED");
    expect(refused.report).toMatchObject({ verdict: "incompatible", release: other, range: pinned.version });
    expect(refused.message).toContain(`Database release: ${other}`);
    expect(refused.message).toContain("state: current");
    expect(refused.message).toContain(`this service works with: ${pinned.version}`);
    expect(refused.message).toContain(`${databaseReleaseCheckName}=warn`);
    expect(refused.message).toContain(`${databaseReleaseCheckName}=off`);
    expect(logged).toEqual([]);
  });

  it("refuses a database that was never stamped, is behind its stamp, or states something that is no release", async () => {
    const range = ">=1.2.0 <2.0.0";
    for (const [answer, verdict] of [
      [stated(null, "unstamped"), "unstamped"],
      [stated("1.5.0", "inconsistent"), "inconsistent"],
      [stated("next", "current"), "unknown"],
      [{ format: "something-else/9", release: "1.5.0", state: "current" }, "unknown"],
      [null, "unknown"],
    ] as const) {
      await expect(
        checkDatabaseRelease(new StatedRelease(answer), { mode: "enforce", range, log: false }),
      ).rejects.toMatchObject({ code: "AIENG_DB_RELEASE_REFUSED", report: { verdict, range } });
    }
  });

  it("treats a database that cannot be asked as no answer: unknown, with the database's error as the reason", async () => {
    const unreachable = new StatedRelease(new ProductError("UNAVAILABLE", "database layer unreachable"));
    await expect(
      checkDatabaseRelease(unreachable, { mode: "enforce", range: "1.2.0", log: false }),
    ).rejects.toMatchObject({
      report: {
        verdict: "unknown",
        release: null,
        state: null,
        reason: "the database could not be asked for its release (UNAVAILABLE: database layer unreachable)",
      },
    });
    const missing = new StatedRelease(new ProductError("NOT_AVAILABLE", "Could not find the function"));
    const report = await checkDatabaseRelease(missing, { mode: "warn", range: "1.2.0", log: false });
    expect(report).toMatchObject({ mode: "warn", verdict: "unknown", warning: false });
  });

  it("starts and logs the warning when the release is in range but the database is not exactly the stamp", async () => {
    for (const state of ["ahead", "component_drift", "unverifiable"]) {
      const logged: DatabaseReleaseReport[] = [];
      const report = await checkDatabaseRelease(new StatedRelease(stated("1.5.0", state)), {
        mode: "enforce",
        range: ">=1.2.0 <2.0.0",
        log: (line) => logged.push(line),
      });
      expect(report).toMatchObject({ verdict: "ok", warning: true, release: "1.5.0", state });
      expect(logged).toEqual([report]);
    }
  });

  it("always starts in warn mode and logs the verdict", async () => {
    const logged: DatabaseReleaseReport[] = [];
    const report = await checkDatabaseRelease(new StatedRelease(stated("1.1.9", "current")), {
      mode: "warn",
      range: ">=1.2.0 <2.0.0",
      log: (line) => logged.push(line),
    });
    expect(report).toMatchObject({ mode: "warn", verdict: "incompatible", release: "1.1.9", state: "current" });
    expect(logged).toEqual([report]);
  });

  it("does not ask the database in off mode", async () => {
    const database = new StatedRelease(new Error("asked"));
    const report = await checkDatabaseRelease(database, { mode: "off", now, log: false });
    expect(report).toEqual({
      mode: "off",
      range: pinned.version,
      release: null,
      state: null,
      verdict: "not_checked",
      warning: false,
      reason: `${databaseReleaseCheckName}=off: the database was not asked`,
      checkedAt: "2026-11-20T00:00:00.000Z",
    });
    expect(database.asked).toBe(0);
  });

  it("refuses when the service cannot state its own range", async () => {
    const database = new StatedRelease(stated("1.5.0", "current"));
    await expect(
      checkDatabaseRelease(database, { mode: "enforce", range: "^1.2.0", log: false }),
    ).rejects.toMatchObject({ report: { verdict: "unknown", range: "^1.2.0" } });
    expect(database.asked).toBe(0);
  });

  it("serves a status without the free-text reason", async () => {
    const report = await checkDatabaseRelease(new StatedRelease(stated("1.5.0", "ahead")), {
      mode: "enforce",
      range: ">=1.2.0 <2.0.0",
      now,
      log: false,
    });
    expect(databaseReleaseStatus(report)).toEqual({
      mode: "enforce",
      range: ">=1.2.0 <2.0.0",
      release: "1.5.0",
      state: "ahead",
      verdict: "ok",
      warning: true,
      checkedAt: "2026-11-20T00:00:00.000Z",
    });
  });
});
