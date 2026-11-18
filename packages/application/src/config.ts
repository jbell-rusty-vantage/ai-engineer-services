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
  /** Service key for byte custody and worker calls only (`AIENG_DB_SECRET_KEY`). */
  readonly databaseSecretKey: string;
  /** Project ref (`AIENG_DB_PROJECT_REF`); absent only for a loopback lab stack. */
  readonly projectRef?: string;
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
