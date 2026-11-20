export type Environment = Readonly<Record<string, string | undefined>>;

/**
 * Server-side configuration, the only reader of the database variables (docs/ENVIRONMENT.md).
 * The secret key never leaves the server process.
 */
export interface ServiceConfig {
  /** API origin of the AI Engineer Supabase project (`AIENG_DB_URL`). */
  readonly databaseUrl: string;
  /** Public key used with the caller's own session (`AIENG_DB_PUBLISHABLE_KEY`). */
  readonly databasePublishableKey: string;
  /** Service key for byte custody, worker calls and the release read at startup only (`AIENG_DB_SECRET_KEY`). */
  readonly databaseSecretKey: string;
  /** Project ref (`AIENG_DB_PROJECT_REF`); absent only for a loopback lab stack. */
  readonly projectRef?: string;
  /** How a transport treats the database's release when it starts (`AIENG_DB_RELEASE_CHECK`; default `enforce`). */
  readonly databaseReleaseCheck: DatabaseReleaseCheckMode;
}

/** What may be logged about the selected database: plane, location, ref and host, never a key or a full URL. */
export interface DatabaseTarget {
  readonly plane: "AIENG";
  readonly location: "local" | "remote";
  readonly projectRef: string | null;
  readonly host: string;
}

/** The single environment reader for required names; lab scripts and the local MCP server import it. */
export function requiredEnvironment(environment: Environment, name: string, hint?: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`MISSING_ENVIRONMENT: ${name}${hint ? ` (${hint})` : ""}`);
  return value;
}

/**
 * The variable that sets the mode of the database release check (features/database-release-check.md). The name is the
 * database contract's, shared with Knowledge Services and Mission Control.
 */
export const databaseReleaseCheckName = "AIENG_DB_RELEASE_CHECK";
export const databaseReleaseCheckModes = ["enforce", "warn", "off"] as const;
/** `enforce` refuses to start on another release, `warn` always starts and logs the verdict, `off` does not ask. */
export type DatabaseReleaseCheckMode = (typeof databaseReleaseCheckModes)[number];

/** `enforce` (the default when the variable is unset), `warn` or `off`; any other word is refused. */
export function checkMode(environment: Environment): DatabaseReleaseCheckMode {
  const raw = environment[databaseReleaseCheckName];
  const mode = (raw ?? "enforce").trim().toLowerCase();
  const known = databaseReleaseCheckModes.find((candidate) => candidate === mode);
  if (!known) throw new Error(`${databaseReleaseCheckName} must be enforce, warn or off (got ${raw})`);
  return known;
}

const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** True for a loopback host (the disposable lab stack); every other host is a remote database. */
export function isLoopbackHost(hostname: string): boolean {
  return loopbackHosts.has(hostname);
}

/**
 * Local by default (docs/ENVIRONMENT.md, "Local by default"): the `dev` and `start` scripts load only the git-ignored
 * `.env.lab` (the loopback lab stack). A remote database is an explicit choice: `AIENG_DB_REMOTE_CONFIRM` must name
 * the same project ref as `AIENG_DB_PROJECT_REF`, or startup refuses.
 */
export const remoteConfirmName = "AIENG_DB_REMOTE_CONFIRM";
const unconfiguredHint =
  "an unconfigured start uses the loopback lab stack: put its values in the git-ignored .env.lab (docs/ENVIRONMENT.md)";

export function loadServiceConfig(environment: Environment = process.env): ServiceConfig {
  const databaseUrl = new URL(requiredEnvironment(environment, "AIENG_DB_URL", unconfiguredHint));
  if (databaseUrl.pathname !== "/" || databaseUrl.search || databaseUrl.hash) throw new Error("INVALID_AIENG_DB_URL");
  const projectRef = environment.AIENG_DB_PROJECT_REF?.trim();
  if (projectRef) {
    if (!databaseUrl.hostname.includes(projectRef)) throw new Error("AIENG_DB_PROJECT_REF_MISMATCH");
  } else if (!isLoopbackHost(databaseUrl.hostname)) {
    throw new Error("MISSING_ENVIRONMENT: AIENG_DB_PROJECT_REF (required unless AIENG_DB_URL is loopback)");
  }
  if (!isLoopbackHost(databaseUrl.hostname) && environment[remoteConfirmName]?.trim() !== projectRef) {
    throw new Error(
      `REMOTE_DATABASE_NOT_CONFIRMED: AIENG_DB_URL is not loopback; set ${remoteConfirmName} to the project ref to ` +
        "choose the remote, or use the lab stack (.env.lab)",
    );
  }
  return {
    databaseUrl: databaseUrl.origin,
    databasePublishableKey: requiredEnvironment(environment, "AIENG_DB_PUBLISHABLE_KEY"),
    databaseSecretKey: requiredEnvironment(environment, "AIENG_DB_SECRET_KEY"),
    ...(projectRef ? { projectRef } : {}),
    databaseReleaseCheck: checkMode(environment),
  };
}

export function describeDatabaseTarget(config: ServiceConfig): DatabaseTarget {
  const host = new URL(config.databaseUrl).hostname;
  return {
    plane: "AIENG",
    location: isLoopbackHost(host) ? "local" : "remote",
    projectRef: config.projectRef ?? null,
    host,
  };
}
