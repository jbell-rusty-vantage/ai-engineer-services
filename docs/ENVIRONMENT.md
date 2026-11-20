# Environment

Names only. Source: `config/env.registry.yaml`; database values: `BellLabs/.secrets/aieng-db.env` (owner-held, never committed). There are no aliases or fallback names.

One database reader: `packages/application/src/config.ts` (`loadServiceConfig`, shared `requiredEnvironment`, `checkMode`). The API and remote MCP entry points call it once, pass the result to `createProductService` and `createDatabaseReleaseCheck`, and log `describeDatabaseTarget` (plane, ref, host only). The lab scripts and the local MCP server import `requiredEnvironment` from the same module.

<a id="local-by-default"></a>
## Local by default

`pnpm dev:api`, `pnpm dev:mcp`, the `start` scripts, `pnpm lab:prove-surfaces` and `pnpm eval:consumer-surface` start Node with `--env-file-if-exists` on the git-ignored `.env.lab` only: the loopback lab stack (`http://127.0.0.1:55621`, plane `lab-aieng-build04` in [`config/planes.toml`](../config/planes.toml)). The process environment wins. Copy `.env.example` to `.env.lab` and fill it from the lab's `supabase status -o env` ([Lab mapping](#lab-mapping)). No script loads `.env`, which holds the remote values; a test in `packages/application/src/config.test.ts` keeps it so.

- **Unconfigured start refuses.** Without `.env.lab` and without `AIENG_DB_URL` in the environment, startup throws `MISSING_ENVIRONMENT: AIENG_DB_URL` and names `.env.lab`.
- **A remote is an explicit choice.** A non-loopback `AIENG_DB_URL` is refused with `REMOTE_DATABASE_NOT_CONFIRMED` unless `AIENG_DB_REMOTE_CONFIRM` names the same project ref as `AIENG_DB_PROJECT_REF`. Set it in the process environment for one run, for example `AIENG_DB_REMOTE_CONFIRM=<ref> node --env-file=.env apps/api/dist/index.js`. Today the remote has no product schema, so it answers nothing useful; the lab is the target.
- **The lab scripts never reach a remote.** `scripts/lab/lab-environment.ts` refuses a non-loopback `AIENG_DB_URL` (`LAB_NOT_LOOPBACK`): they create users and write fixture data.
- The listening log line names `database.location` (`local` or `remote`), the ref and the host, never a key.

## Database (server processes)

| Name | Read by | Unset or wrong means |
| --- | --- | --- |
| `AIENG_DB_URL` | API, remote MCP (`loadServiceConfig`); lab scripts | startup throws `MISSING_ENVIRONMENT: AIENG_DB_URL`; a path, query or fragment throws `INVALID_AIENG_DB_URL` |
| `AIENG_DB_PUBLISHABLE_KEY` | same | `MISSING_ENVIRONMENT`; every caller request lacks its `apikey` |
| `AIENG_DB_SECRET_KEY` | same | `MISSING_ENVIRONMENT`; no byte custody, worker calls or release read at startup |
| `AIENG_DB_PROJECT_REF` | `loadServiceConfig` | not in the URL host: `AIENG_DB_PROJECT_REF_MISMATCH`; unset with a non-loopback URL: `MISSING_ENVIRONMENT` |
| `AIENG_DB_REMOTE_CONFIRM` | `loadServiceConfig` | unset or not the project ref with a non-loopback URL: `REMOTE_DATABASE_NOT_CONFIRMED` ([local by default](#local-by-default)) |
| `AIENG_DB_RELEASE_CHECK` | `loadServiceConfig` (`checkMode`) | unset: `enforce`; any word but `enforce`, `warn` or `off` (an empty value included) refuses when the configuration loads ([release check](#release-check)) |

<a id="release-check"></a>
## Release check

`AIENG_DB_RELEASE_CHECK` sets how the API and the remote MCP server treat the database's release when they start ([database release check](../features/database-release-check.md)). The name is the database contract's, shared with Knowledge Services and Mission Control.

| Value | A transport that starts |
| --- | --- |
| `enforce` (default) | asks `api.database_release()` and refuses (`AIENG_DB_RELEASE_REFUSED`) unless the database states a release in the service's range, which is the version of the pinned contract package |
| `warn` | asks, logs the verdict and starts whatever it is |
| `off` | does not ask |

The read uses `AIENG_DB_SECRET_KEY`: no caller exists at startup and the function is not executable by `anon`. Set the variable in the process environment, or in `.env.lab` for a lab that is not stamped with the pinned release.

## Service and client

| Name | Read by | Default / unset means |
| --- | --- | --- |
| `AIENG_API_HOST`, `AIENG_API_PORT` | `apps/api/src/index.ts` | `127.0.0.1`, `3200` |
| `AIENG_MCP_HOST`, `AIENG_MCP_PORT` | `apps/mcp/src/remote.ts` | `127.0.0.1`, `3201` |
| `AIENG_API_URL` | `apps/cli/src/main.ts`, `apps/mcp/src/stdio.ts`, `scripts/lab/prove-surfaces.ts` | required by the CLI and local MCP; the lab proof defaults to `http://127.0.0.1:3200` |
| `AIENG_ACCESS_TOKEN` | `apps/cli/src/main.ts`, `apps/mcp/src/stdio.ts`, `scripts/consumer-surface-eval.ts` | required by the CLI and local MCP; the calling user's own Supabase session token (secret). The consumer evaluation uses it when set, and otherwise creates a lab user (loopback `AIENG_DB_URL` only) |
| `AIENG_CLIENT_TOKEN` | `apps/cli/src/main.ts`, `apps/mcp/src/stdio.ts` | optional scoped grant from `create_client_grant` (secret) |
| `AIENG_SCHEMA_WORKSPACE_DIR` | API, remote MCP (`resolveSchemaWorkspaceDirectory` in `packages/application/src/schema/schema-workspace-location.ts`) | the generated schema workspace of `ai-engineer-db-contract`; unset: the sibling checkout `../ai-engineer-db-contract/workspace` when it exists, otherwise schema navigation answers `NOT_AVAILABLE` |

`aieng guide` and `aieng describe` need no variable: they answer from the catalog built into the CLI.

<a id="lab-mapping"></a>
## Lab mapping

The disposable lab stack's `supabase status -o env` prints Supabase-style names. The single code location is `SUPABASE_STATUS_TO_AIENG_DB` in `scripts/lab/lab-environment.ts`:

| `supabase status -o env` | Export as |
| --- | --- |
| `API_URL` | `AIENG_DB_URL` |
| `PUBLISHABLE_KEY` (older CLIs: `ANON_KEY`) | `AIENG_DB_PUBLISHABLE_KEY` |
| `SECRET_KEY` (older CLIs: `SERVICE_ROLE_KEY`) | `AIENG_DB_SECRET_KEY` |

A loopback `AIENG_DB_URL` needs no `AIENG_DB_PROJECT_REF`.
