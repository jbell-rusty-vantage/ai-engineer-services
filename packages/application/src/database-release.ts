import type { ApiDatabaseRelease, ApiDatabaseReleaseState, ApiReleaseVerdict } from "@aiengineer/database-contract/api";
import { type DatabaseReleaseCheckMode, databaseReleaseCheckName } from "./config.js";
import type { DatabaseGateway } from "./database-gateway.js";
import { serviceReleaseRange } from "./pinned-contract.js";

/**
 * The database release check (VER-S1, D-117; features/database-release-check.md).
 *
 * One release number covers the whole AI Engineer database: the contract version. The database states it through
 * `api.database_release()`; this service states the releases it works with (its range, the version of the pinned
 * contract package) and a transport refuses to start on any other. The rule is a port of the contract repository's
 * `scripts/database-release.mjs` (`inRange`, `releaseVerdict`; `checkMode` is in `config.ts`, the one reader of the
 * variable). Knowledge Services and Mission Control apply the same rule, and all three run the cases the contract
 * package ships as `release-check.cases.json`.
 */

/** The `format` of the answer this port reads; an answer in another format counts as no answer. */
export const databaseReleaseFormat = "ai-engineer-database-release/1" satisfies ApiDatabaseRelease["format"];

export type DatabaseReleaseState = ApiDatabaseReleaseState;
/** `start`: whether a transport in enforce mode starts. `warning`: it starts on a database that is not exactly the stamped release. */
export type DatabaseReleaseVerdict = ApiReleaseVerdict;

const versionPattern = /^(\d+)\.(\d+)\.(\d+)$/;
const rangePattern = /^>=(\d+\.\d+\.\d+) <(\d+\.\d+\.\d+)$/;

function versionParts(version: string): readonly [number, number, number] {
  const match = versionPattern.exec(version);
  if (!match) throw new Error(`not a release version: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** -1, 0 or 1: numeric comparison of two X.Y.Z versions. */
export function compareVersions(left: string, right: string): -1 | 0 | 1 {
  const [a, b] = [versionParts(left), versionParts(right)];
  for (const index of [0, 1, 2] as const) if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  return 0;
}

/** Whether a release is inside a consumer's range: an exact version, or ">=A.B.C <D.E.F". */
export function inRange(version: string, range: string): boolean {
  if (versionPattern.test(range)) return compareVersions(version, range) === 0;
  const match = rangePattern.exec(range);
  if (!match?.[1] || !match[2]) throw new Error(`not a release range: ${range} (write X.Y.Z or ">=A.B.C <D.E.F")`);
  return compareVersions(version, match[1]) >= 0 && compareVersions(version, match[2]) < 0;
}

const warnings: Readonly<Record<string, string>> = {
  ahead: "migrations were applied after the stamp (unreleased changes)",
  component_drift: "a guest component differs from the version the release pins",
  unverifiable: "the migration list could not be read, so the stamp is unchecked",
};

/**
 * The verdict on what `api.database_release()` returned (null when the database gave no answer) for a range. Nothing
 * or another format is `unknown`, a null release `unstamped`, a release outside the range `incompatible`, state
 * `inconsistent` is `inconsistent`: all four refuse. In range with state `current` is `ok`; with `ahead`,
 * `component_drift` or `unverifiable` it is `ok` with a warning. Throws when the stated release is not a version.
 */
export function releaseVerdict(observed: unknown, range: string): DatabaseReleaseVerdict {
  const answer = (observed !== null && typeof observed === "object" ? observed : {}) as {
    readonly format?: unknown;
    readonly release?: unknown;
    readonly state?: unknown;
  };
  const release = answer.release == null ? null : String(answer.release);
  const state = answer.state == null ? null : (String(answer.state) as DatabaseReleaseState);
  const facts = { range, release, state };
  const refuse = (verdict: DatabaseReleaseVerdict["verdict"], reason: string): DatabaseReleaseVerdict => ({
    verdict,
    start: false,
    warning: false,
    ...facts,
    reason,
  });
  if (answer.format !== databaseReleaseFormat)
    return refuse(
      "unknown",
      "the database does not state a release (api.database_release() is missing or answered in another format)",
    );
  if (release === null) return refuse("unstamped", "the database has never been stamped with a release");
  if (!inRange(release, range))
    return refuse("incompatible", `the database is release ${release}; this service works with ${range}`);
  if (state === "inconsistent")
    return refuse("inconsistent", `the database is stamped ${release} but its migrations are behind that release`);
  if (state === "current")
    return { verdict: "ok", start: true, warning: false, ...facts, reason: `the database is release ${release}` };
  const why = warnings[String(state)] ?? `state ${String(state)}`;
  return { verdict: "ok", start: true, warning: true, ...facts, reason: `the database is release ${release}; ${why}` };
}

/** What a transport knows about the database release it started on. The database is asked once, when it starts. */
export interface DatabaseReleaseReport {
  /** The mode the check ran in (`AIENG_DB_RELEASE_CHECK`). */
  readonly mode: DatabaseReleaseCheckMode;
  /** The database releases this service works with: the version of the pinned contract. */
  readonly range: string;
  /** The release the database stated; null when it stated none or was not asked. */
  readonly release: string | null;
  /** The state word the database stated beside its release. */
  readonly state: string | null;
  /** The verdict of the rule; `not_checked` when the mode is `off`. */
  readonly verdict: DatabaseReleaseVerdict["verdict"] | "not_checked";
  /** True when the service runs on a database that is not exactly the stamped release. */
  readonly warning: boolean;
  /** The verdict in words; it may carry the database's own error text. */
  readonly reason: string;
  /** When the database was asked (ISO 8601); the report is not refreshed afterwards. */
  readonly checkedAt: string;
}

/** The report without its free-text reason: what an answer that needs no session (`GET /health`) may carry. */
export type DatabaseReleaseStatus = Omit<DatabaseReleaseReport, "reason">;

export function databaseReleaseStatus(report: DatabaseReleaseReport): DatabaseReleaseStatus {
  const { reason: _reason, ...status } = report;
  return status;
}

/** A transport must not start: the database is not a release this service works with (enforce mode). */
export class DatabaseReleaseRefused extends Error {
  readonly code = "AIENG_DB_RELEASE_REFUSED";

  constructor(readonly report: DatabaseReleaseReport) {
    super(
      `AIENG_DB_RELEASE_REFUSED: the AI Engineer database is not a release this service works with ` +
        `(verdict ${report.verdict}: ${report.reason}). Database release: ${report.release ?? "none stated"}; ` +
        `state: ${report.state ?? "none stated"}; this service works with: ${report.range}. ` +
        `${databaseReleaseCheckName}=warn starts anyway and logs this verdict; ` +
        `${databaseReleaseCheckName}=off does not ask the database.`,
    );
    this.name = "DatabaseReleaseRefused";
  }
}

export interface DatabaseReleaseCheckOptions {
  readonly mode: DatabaseReleaseCheckMode;
  /** The releases this service works with. Default: the version of the pinned contract (`serviceReleaseRange`). */
  readonly range?: string;
  /** Receives the report of a start (a refusal is thrown instead). Default: one JSON line; `false` is silent. */
  readonly log?: ((report: DatabaseReleaseReport) => void) | false;
  readonly now?: () => Date;
}

/** The check a transport runs when it starts: resolves to the report it serves, rejects when it must not start. */
export type DatabaseReleaseCheck = () => Promise<DatabaseReleaseReport>;

/** One JSON line: on stdout for a clean `ok`, on stderr for a warning, another verdict or a skipped check. */
function writeDatabaseReleaseLine(report: DatabaseReleaseReport): void {
  const stream = report.verdict === "ok" && !report.warning ? process.stdout : process.stderr;
  stream.write(`${JSON.stringify({ event: "aieng.database.release", ...report })}\n`);
}

const said = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Asks the database for its release through the database port, applies the rule and decides:
 *
 * - `off`: the database is not asked; the report says `not_checked`.
 * - `enforce`: a verdict that does not start rejects with {@link DatabaseReleaseRefused}; a warning is logged.
 * - `warn`: the verdict is logged and the transport starts whatever it is.
 *
 * A database that cannot be asked (unreachable, function missing, not permitted, no service key) gave no answer: the
 * verdict is `unknown`. So is a service that cannot read its own range (the contract package is not installed).
 */
export async function checkDatabaseRelease(
  database: Pick<DatabaseGateway, "databaseRelease">,
  options: DatabaseReleaseCheckOptions,
): Promise<DatabaseReleaseReport> {
  const { mode } = options;
  const checkedAt = (options.now?.() ?? new Date()).toISOString();
  const log = options.log === false ? undefined : (options.log ?? writeDatabaseReleaseLine);
  let range = "unknown";
  let rangeless: string | undefined;
  try {
    range = options.range ?? serviceReleaseRange();
    inRange("0.0.0", range);
  } catch (error) {
    rangeless = `this service cannot state the releases it works with (${said(error)})`;
  }
  if (mode === "off") {
    const skipped: DatabaseReleaseReport = {
      mode,
      range,
      release: null,
      state: null,
      verdict: "not_checked",
      warning: false,
      reason: `${databaseReleaseCheckName}=off: the database was not asked`,
      checkedAt,
    };
    log?.(skipped);
    return skipped;
  }
  const noAnswer = (reason: string): DatabaseReleaseVerdict => ({
    verdict: "unknown",
    start: false,
    warning: false,
    range,
    release: null,
    state: null,
    reason,
  });
  const ask = async (): Promise<DatabaseReleaseVerdict> => {
    let observed: unknown;
    try {
      observed = await database.databaseRelease();
    } catch (error) {
      return noAnswer(`the database could not be asked for its release (${said(error)})`);
    }
    try {
      return releaseVerdict(observed, range);
    } catch (error) {
      return noAnswer(`the database stated a release this service cannot read (${said(error)})`);
    }
  };
  const verdict = rangeless === undefined ? await ask() : noAnswer(rangeless);
  const report: DatabaseReleaseReport = {
    mode,
    range,
    release: verdict.release,
    state: verdict.state,
    verdict: verdict.verdict,
    warning: verdict.warning,
    reason: verdict.reason,
    checkedAt,
  };
  if (!verdict.start && mode === "enforce") throw new DatabaseReleaseRefused(report);
  log?.(report);
  return report;
}
