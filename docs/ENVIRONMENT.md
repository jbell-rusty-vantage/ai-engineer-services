# Environment

Names only. Source: `config/env.registry.yaml`; database values: `BellLabs/.secrets/aieng-db.env` (owner-held, never committed). There are no aliases or fallback names.

One database reader: `packages/application/src/config.ts` (`loadServiceConfig`, shared `requiredEnvironment`). The API and remote MCP entry points call it once, pass the result to `createProductService`, and log `describeDatabaseTarget` (plane, ref, host only). The lab scripts and the local MCP server import `requiredEnvironment` from the same module.

Local runs: `pnpm dev:api`, `pnpm dev:mcp`, the `start` scripts and `pnpm lab:prove-surfaces` start Node with `--env-file-if-exists` on this repository's git-ignored `.env`; the process environment wins. Copy `.env.example`.

## Database (server processes)

| Name | Read by | Unset or wrong means |
| --- | --- | --- |
| `AIENG_DB_URL` | API, remote MCP (`loadServiceConfig`); lab scripts | startup throws `MISSING_ENVIRONMENT: AIENG_DB_URL`; a path, query or fragment throws `INVALID_AIENG_DB_URL` |
| `AIENG_DB_PUBLISHABLE_KEY` | same | `MISSING_ENVIRONMENT`; every caller request lacks its `apikey` |
| `AIENG_DB_SECRET_KEY` | same | `MISSING_ENVIRONMENT`; no byte custody or worker calls |
| `AIENG_DB_PROJECT_REF` | `loadServiceConfig` | not in the URL host: `AIENG_DB_PROJECT_REF_MISMATCH`; unset with a non-loopback URL: `MISSING_ENVIRONMENT` |

## Service and client

| Name | Read by | Default / unset means |
| --- | --- | --- |
| `AIENG_API_HOST`, `AIENG_API_PORT` | `apps/api/src/index.ts` | `127.0.0.1`, `3200` |
| `AIENG_MCP_HOST`, `AIENG_MCP_PORT` | `apps/mcp/src/remote.ts` | `127.0.0.1`, `3201` |
| `AIENG_API_URL` | `apps/cli/src/main.ts`, `apps/mcp/src/stdio.ts`, `scripts/lab/prove-surfaces.ts` | required by the CLI and local MCP; the lab proof defaults to `http://127.0.0.1:3200` |
| `AIENG_ACCESS_TOKEN` | `apps/cli/src/main.ts`, `apps/mcp/src/stdio.ts` | required; the calling user's own Supabase session token (secret) |
| `AIENG_CLIENT_TOKEN` | same | optional scoped grant from `create_client_grant` (secret) |

## Lab mapping

The disposable lab stack's `supabase status -o env` prints Supabase-style names. The single code location is `SUPABASE_STATUS_TO_AIENG_DB` in `scripts/lab/lab-environment.ts`:

| `supabase status -o env` | Export as |
| --- | --- |
| `API_URL` | `AIENG_DB_URL` |
| `PUBLISHABLE_KEY` (older CLIs: `ANON_KEY`) | `AIENG_DB_PUBLISHABLE_KEY` |
| `SECRET_KEY` (older CLIs: `SERVICE_ROLE_KEY`) | `AIENG_DB_SECRET_KEY` |

A loopback `AIENG_DB_URL` needs no `AIENG_DB_PROJECT_REF`.
