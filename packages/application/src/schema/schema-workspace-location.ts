import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Environment } from "../config.js";

/** The file every generated schema workspace has; its presence marks a usable workspace directory. */
export const schemaWorkspaceFingerprintFile = "fingerprint.json";

function repositoryRoot(start: string): string | undefined {
  let directory = start;
  for (;;) {
    if (existsSync(join(directory, "pnpm-workspace.yaml"))) return directory;
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

/**
 * Where the generated schema workspace of `ai-engineer-db-contract` is: `AIENG_SCHEMA_WORKSPACE_DIR` when set,
 * otherwise the sibling checkout `../ai-engineer-db-contract/workspace` when it exists. `undefined` means schema
 * navigation is not available in this deployment.
 */
export function resolveSchemaWorkspaceDirectory(
  environment: Environment = process.env,
  start: string = dirname(fileURLToPath(import.meta.url)),
): string | undefined {
  const configured = environment.AIENG_SCHEMA_WORKSPACE_DIR?.trim();
  if (configured) return resolve(configured);
  const repository = repositoryRoot(start);
  if (!repository) return undefined;
  const sibling = resolve(repository, "..", "ai-engineer-db-contract", "workspace");
  return existsSync(join(sibling, schemaWorkspaceFingerprintFile)) ? sibling : undefined;
}
