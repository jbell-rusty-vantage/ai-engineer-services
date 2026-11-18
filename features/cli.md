# CLI

`aieng`, a thin client over the HTTP API (`packages/client`), with the guide and describe built in.

- Code: `apps/cli/src/main.ts` (environment, dispatch), `commands.ts`, `knowledge-commands.ts`,
  `authoring-commands.ts`, `options.ts`; the command list is in `packages/contracts/src/surface.ts`.
- Tests: `apps/cli/src/commands.test.ts`.

## Reach it

`pnpm build`, then `node apps/cli/dist/main.js <command>`. `aieng guide`, `aieng describe` and `aieng operations` need
no variable; every other command needs `AIENG_API_URL` (a running API) and `AIENG_ACCESS_TOKEN` (the user's Supabase
session), optionally `AIENG_CLIENT_TOKEN`. With no argument it prints the usage.

Proven by: `pnpm --filter @aiengineer/service-cli test`; offline: `node apps/cli/dist/main.js describe search_knowledge`.

## Gotchas

- Never commit or print a token; the CLI reads them from the environment only.
- `aieng command` and `aieng read` reach any public operation; prefer a named command where one exists.
