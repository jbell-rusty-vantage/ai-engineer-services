# Database target: local by default

Which database a server process (API, remote MCP) and the lab scripts reach, and how an agent inspects the planes.
Since 2026-11-18 (OVE-243, SPEC-03 K3) a bare start reaches the loopback lab or refuses; a remote is an explicit choice.

- Code: `packages/application/src/config.ts` (`loadServiceConfig`, `isLoopbackHost`, `describeDatabaseTarget`),
  `scripts/lab/lab-environment.ts` (refuses a remote), the package scripts' `--env-file-if-exists=.env.lab`; the plane
  registry `config/planes.toml` and `scripts/dev/planes.py` (Mission Control's module).
- Tests: `packages/application/src/config.test.ts` (lab default, unconfigured refusal, remote confirmation, and that no
  package script loads `.env`). Details: [environment, local by default](../docs/ENVIRONMENT.md#local-by-default).

## Reach it

| Want | Do |
| --- | --- |
| The lab (default) | `.env.lab` with the lab values (`http://127.0.0.1:55621`), then any `dev` or `start` script |
| A remote, for one run | `AIENG_DB_REMOTE_CONFIRM=<project ref> node --env-file=.env apps/api/dist/index.js` |
| See what a start would bind to | `./dev status` (`database_target`, `local_services`) |
| The planes and their posture | `./dev planes list`, `./dev planes show lab-aieng-build04`, `./dev planes check` |
| Read a plane's Postgres directly | `./dev db status --plane lab-aieng-build04` (read-only; `uv run` supplies psycopg) |

Proven by: `pnpm --filter @aiengineer/service-application exec vitest run src/config.test.ts`; `./dev planes check`.

## Gotchas

- The remote `aieng-db` has no product schema today, so a remote start answers nothing useful.
- Reaching a database is not enough to start on it: the API and the remote MCP server also check its release and
  refuse any but the pinned one ([database release check](database-release-check.md)).
- The repository `.env` still holds the remote values; nothing loads it by default. Moving remote credentials out of
  repository `.env` files is the workspace-wide step of DATA-ACCESS §5.2, not done here.
- `aieng-graph` (`4773dc72`) is retired: `./dev planes` and `./dev db` refuse it.
- `./dev db` is read-only by default; a write needs `--write --confirm <ref>` and is refused on protected planes. The
  lab is `protected-local`: a write there needs `--confirm supabase_db_disposable-aieng-build04`.
- `./dev db` was not run against any plane when it was adopted here (no database connection in that session); the
  module is Mission Control's, with its tests there.
