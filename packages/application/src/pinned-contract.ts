import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * The database contract this service is built for: the `@aiengineer/database-contract` package this package's manifest
 * pins (the tarball under `vendor/`). Its release is read from the installed package's `contract.version.json`, so no
 * version number is written in this repository's source: moving the pin moves the release.
 */
export const databaseContractPackage = "@aiengineer/database-contract";

export interface PinnedContract {
  /** The contract version: the database release this service was built for. */
  readonly version: string;
  /** The last migration of that release's chain. */
  readonly migrationHead: string;
  /** The installed package directory; it also holds `release-check.cases.json` and `releases/`. */
  readonly packageRoot: string;
}

const versionPattern = /^\d+\.\d+\.\d+$/;
let pinned: PinnedContract | undefined;

function packageRoot(): string {
  const missing = `DATABASE_CONTRACT_PACKAGE_MISSING: ${databaseContractPackage} is not installed beside this package (pnpm install --frozen-lockfile)`;
  let directory: string;
  try {
    directory = dirname(createRequire(import.meta.url).resolve(databaseContractPackage));
  } catch {
    throw new Error(missing);
  }
  for (;;) {
    const manifest = join(directory, "package.json");
    if (existsSync(manifest)) {
      const { name } = JSON.parse(readFileSync(manifest, "utf8")) as { name?: unknown };
      if (name === databaseContractPackage) return directory;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error(missing);
    directory = parent;
  }
}

/** Reads `contract.version.json` of the installed contract package (once per process). */
export function pinnedContract(): PinnedContract {
  if (pinned) return pinned;
  const root = packageRoot();
  const record = JSON.parse(readFileSync(join(root, "contract.version.json"), "utf8")) as {
    version?: unknown;
    migration_head?: unknown;
  };
  if (typeof record.version !== "string" || !versionPattern.test(record.version))
    throw new Error(
      `DATABASE_CONTRACT_VERSION_INVALID: contract.version.json of ${databaseContractPackage} names no X.Y.Z version`,
    );
  pinned = { version: record.version, migrationHead: String(record.migration_head ?? ""), packageRoot: root };
  return pinned;
}

/**
 * The database releases this service works with: the exact version of the pinned contract. Until contract 1.0.0 every
 * bump may break, so the range is that one version; from 1.0.0 a service states `>=A.B.C <D.E.F`.
 */
export function serviceReleaseRange(): string {
  return pinnedContract().version;
}
