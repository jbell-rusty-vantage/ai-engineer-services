# MCP server

The 21 task-shaped tools of the surface catalog, written once (`apps/mcp/src/tools/`) and served two ways: a local
stdio server for a harness, which calls the running API through `packages/client`, and a remote streamable HTTP server
for agents without a sandbox, which calls `packages/application` in process.

- Code: `apps/mcp/src/server.ts` (registration), `apps/mcp/src/tools/*.ts`, `apps/mcp/src/stdio.ts`,
  `apps/mcp/src/remote.ts` and `remote-host.ts`.
- Tests: `apps/mcp/src/server.test.ts` (tool set, protocol, every tool family).

## Reach it

| Mode | Start | Needs |
| --- | --- | --- |
| stdio (harness) | `node apps/mcp/dist/stdio.js` (bin `ai-engineer-mcp`) | `AIENG_API_URL`, `AIENG_ACCESS_TOKEN`, optional `AIENG_CLIENT_TOKEN` |
| remote HTTP | `pnpm --filter @aiengineer/service-mcp start:remote` or `pnpm dev:mcp`: `http://127.0.0.1:3201/mcp` | the database variables, from `.env.lab` by default |

Proven by: `pnpm --filter @aiengineer/service-mcp test`.

## Gotchas

- A new tool needs a real agent workflow and an entry in `packages/contracts/src/surface.ts`; the test fails on any
  tool the catalog does not list.
- The remote server refuses local folder arguments.
