# Database release check

The service knows which AI Engineer database release it was built for, asks the database which release it is before a
transport serves, refuses to start on any other, and reports the release it runs on (VER-S1, decision D-117,
2026-11-20). One release number covers the whole database: the contract version. The database states it through
`api.database_release()`, which exists from database contract 0.12.0. Knowledge Services and Mission Control apply the
identical rule, and all three run the cases the contract package ships as `release-check.cases.json`. The design is the
contract repository's [version and release](../../ai-engineer-db-contract/features/version-and-release.md#check).

- Code: [database-release.ts](../packages/application/src/database-release.ts) (`inRange`, `releaseVerdict`,
  `checkDatabaseRelease`, `DatabaseReleaseRefused`), a port of the contract repository's
  [database-release.mjs](../../ai-engineer-db-contract/scripts/database-release.mjs);
  [pinned-contract.ts](../packages/application/src/pinned-contract.ts) (`pinnedContract`, `serviceReleaseRange`);
  [config.ts](../packages/application/src/config.ts) (`checkMode`, the one reader of the variable);
  [database-gateway.ts](../packages/application/src/database-gateway.ts) (`databaseRelease`, the read);
  [index.ts](../packages/application/src/index.ts) (`createDatabaseReleaseCheck`). The transports run it in
  [server.ts](../apps/api/src/server.ts) and [remote-host.ts](../apps/mcp/src/remote-host.ts); their entry points
  ([index.ts](../apps/api/src/index.ts), [remote.ts](../apps/mcp/src/remote.ts)) print the refusal.
- Tests: [database-release.test.ts](../packages/application/src/database-release.test.ts) (every shared case from the
  pinned package, the range, the three modes, the refusal), [config.test.ts](../packages/application/src/config.test.ts)
  ("the database release check mode"), [knowledge-service.test.ts](../packages/application/src/knowledge/knowledge-service.test.ts)
  ("asks api.database_release with the service key"), [server.test.ts](../apps/api/src/server.test.ts) and
  [remote-host.test.ts](../apps/mcp/src/remote-host.test.ts) ("database release check": the start refused, the start
  allowed, the `/health` payload).

<a id="rule"></a>
## The rule

| The database answers | Verdict | In `enforce` mode |
| --- | --- | --- |
| nothing (function missing, not permitted, unreachable, no secret key, or another format) | `unknown` | refuses to start |
| `release` is null | `unstamped` | refuses |
| a release outside the service's range | `incompatible` | refuses |
| in range, state `inconsistent` | `inconsistent` | refuses |
| in range, state `ahead`, `component_drift` or `unverifiable` | `ok` with a warning | starts and logs the warning |
| in range, state `current` | `ok` | starts |

<a id="pin"></a>
## The pin and the range

The contract is pinned as a package. The tarball the contract repository packs (`npm run pack:contract` there) is
tracked under `vendor/`, and [packages/application/package.json](../packages/application/package.json) depends on
`@aiengineer/database-contract` with a `file:` reference to it. `pnpm-lock.yaml` records the tarball's integrity, so
`pnpm install --frozen-lockfile` installs exactly that package on a machine with no sibling checkout (CI).

The service's range is the `version` in the installed package's `contract.version.json`, read at run time by
`serviceReleaseRange()`. No version number is written in this repository's source: moving the pin moves the range.
Until contract 1.0.0 the range is that exact version; `>=A.B.C <D.E.F` is the other form the rule reads. The types the
port uses (`ApiDatabaseRelease`, `ApiReleaseVerdict`) are imported from the same package.

`./dev status` prints the pin: `contract.pinned`, and under `contract.pin` the reference, the tarball's sha256, the
migration head and the version installed in `node_modules`. It hints when the sibling contract checkout has moved past
the pin. To move the pin: copy the new tarball into `vendor/`, compare its sha256 with the one `pack:contract` printed,
change the `file:` reference, run `pnpm install`, remove the old tarball, then `./dev check`.

<a id="mode"></a>
## The mode

`AIENG_DB_RELEASE_CHECK` is `enforce` (the default), `warn` (always start, log the verdict) or `off` (do not ask the
database). Any other word, an empty value included, refuses when the configuration loads. The name is the contract's,
shared by the three services. Only `config.ts` reads it ([environment](../docs/ENVIRONMENT.md#release-check)).

<a id="credential"></a>
## The read and its credential

`PostgrestDatabaseGateway.databaseRelease()` calls `api.database_release()` through PostgREST, the way every other
database call of this service travels. A transport that is starting has no caller, and the contract does not let `anon`
execute the function, so the publishable key alone cannot ask. The read is made with the secret key (`service_role`,
one of the roles the contract grants the function to).

This repository allows the secret key for byte custody and worker calls. The release read is treated as a worker call:
the deployment makes it, once per start, on no user's behalf, and the answer holds no user data (the release, a state
word, the migration head and the component versions). Every user call still runs with the caller's own session. A
gateway without a secret key asks nothing and the verdict is `unknown`. The read is abandoned after 10 seconds.

<a id="where"></a>
## Where it runs and where it is reported

| Process | When it checks | Where it reports |
| --- | --- | --- |
| API (`apps/api`) | once, in the server's `onReady` hook, before it listens | `GET /health`, field `databaseRelease` (no session) |
| Remote MCP server (`apps/mcp`, `remote.ts`) | the same, in the host's `onReady` hook | `GET /health`, field `databaseRelease` |
| `aieng` CLI, local MCP server (stdio) | never: they call the API and do not touch the database | nothing of their own |

`databaseRelease` is `{ mode, range, release, state, verdict, warning, checkedAt }`. `verdict` is `ok`, `unknown`,
`unstamped`, `incompatible`, `inconsistent`, or `not_checked` in `off` mode. `GET /health` keeps `status: "ok"` in
`warn` mode whatever the verdict, so read the verdict. The reason in words is not on `/health`, which needs no
session and could repeat a database error; it is in the log line and in the refusal:

- A start writes one JSON line, `{"event":"aieng.database.release", …, "reason": …}`: on stdout for a clean `ok`, on
  stderr for a warning, another verdict or a skipped check.
- A refusal writes one JSON line on stderr and exits 1: `{"event":"aieng.api.start_failed","code":"AIENG_DB_RELEASE_REFUSED","message": …}`
  (`aieng.mcp.start_failed` for the remote MCP server). The message names the verdict and its reason, the database's
  release, its state, the service's range and the variable that changes the mode.
- `./dev status` shows `contract.database_release.range` and, for a running API or remote MCP server,
  `local_services.<name>.database_release` (what its `/health` says). It asks no database itself;
  `./dev db query --plane <plane> --sql "select api.database_release()"` reads one read-only.

## Reach it

| Want | Do |
| --- | --- |
| The release a running service found | `GET http://127.0.0.1:3200/health` (API) or `:3201/health` (remote MCP); or `./dev status` |
| The release this checkout is built for | `./dev status`, `contract.pinned` |
| Start on a database that is not that release, knowingly | `AIENG_DB_RELEASE_CHECK=warn` in the process environment or in `.env.lab` |
| Start without asking | `AIENG_DB_RELEASE_CHECK=off` |

Proven by: `pnpm --filter @aiengineer/service-application exec vitest run src/database-release.test.ts` (offline: the
shared cases and the range, both read from the pinned package); the starts refused and allowed with each transport's
own server: `pnpm --filter @aiengineer/service-api test`, `pnpm --filter @aiengineer/service-mcp test`.

## Gotchas

- Not run live. No transport has started against a database with this check: on 2026-11-20 only the lab's Postgres
  container was running, not its Supabase API. The PostgREST call (the secret key's role, the JSON a `jsonb` function
  returns) is tested against a recorded `fetch` only.
- A lab built from drafts must be stamped before a transport starts on it in `enforce` mode
  (`node scripts/database-release.mjs stamp --workdir <lab workdir>` in the contract repository). Migrations applied
  after the stamp give state `ahead`: the service starts and warns.
- A database that predates the function answers nothing: verdict `unknown`, and `enforce` refuses. The contract's
  reference also has a pre-check (`holdsContract`, `notApplicable`) for a consumer that can be bound to a database
  with no `api` schema. It is not ported: this service always needs the contract, so such a database is `unknown` too.
- `pnpm lab:prove-surfaces` and `pnpm eval:consumer-surface` build transports in process, so they run the check too;
  `pnpm eval:consumer-surface --without-database` has nothing to ask and runs it in `off` mode.
- The check runs when a transport starts, not on every request. A database that changes release under a running
  process is seen at the next start; `checkedAt` says when it was asked.
- No MCP tool and no `aieng` command reports the release: the tools are task-shaped and the guide is static text. An
  agent that needs it reads `GET <AIENG_API_URL>/health`.
- An empty `AIENG_DB_RELEASE_CHECK=` line in `.env.lab` is refused like any other unknown word; remove the line or
  comment it out.
