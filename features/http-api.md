# HTTP API

The Fastify API over `packages/application`: reference routes that need no session, and operation routes that run as
the caller.

- Code: `apps/api/src/server.ts` (routes), `apps/api/src/index.ts` (entry: `loadServiceConfig`, listen, log the
  database target).
- Tests: `apps/api/src/server.test.ts` ("API server", "reference routes", "knowledge reads").

| Route | Session |
| --- | --- |
| `GET /health` | none |
| `GET /v1/guide[/<topic>]`, `GET /v1/operations[/<operation>]`, `GET /v1/schema/search`, `GET /v1/schema/pages[/<page>]` | none |
| `POST /v1/reads/<operation>`, `POST /v1/commands/<operation>` | `authorization: Bearer <user session>`, optional client token |
| `POST /v1/assets` | as above; byte custody uses the secret key after a user-authorized registration |

## Reach it

`pnpm build`, then `pnpm --filter @aiengineer/service-api start` (or `pnpm dev:api`): `http://127.0.0.1:3200`
(`AIENG_API_HOST`, `AIENG_API_PORT`), against the lab in `.env.lab` ([database target](database-target.md)).
`./dev status` shows whether it answers `/health`.

Proven by: `pnpm --filter @aiengineer/service-api test`.

## Gotchas

- Errors are `{ code, message, detail? }` bodies with the HTTP status mapped from `ProductErrorCode`.
- A start without `.env.lab` refuses (`MISSING_ENVIRONMENT`); a remote URL without `AIENG_DB_REMOTE_CONFIRM` refuses
  (`REMOTE_DATABASE_NOT_CONFIRMED`).
