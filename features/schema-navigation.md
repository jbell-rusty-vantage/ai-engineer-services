# Schema navigation

Find where something lives in the schema: search and read the pages of the generated schema workspace of
`ai-engineer-db-contract`. File reads only; no database call.

- Code: `packages/application/src/schema/` (`schema-workspace.ts`, `schema-index.ts`, and
  `schema-workspace-location.ts`, which resolves the directory); contract in `packages/contracts/src/schema-navigation.ts`.
- Tests: `packages/application/src/schema/schema-workspace.test.ts` (fixture workspaces in a temporary directory);
  `apps/mcp/src/server.test.ts` ("schema tools"); `apps/cli/src/commands.test.ts` ("aieng schema");
  `packages/client/src/ai-engineer-client.test.ts` ("schema navigation").

## Reach it

| Transport | How |
| --- | --- |
| MCP | `schema_search`, `schema_get` |
| CLI | `aieng schema search <query>`, `aieng schema get [page]` |
| HTTP | `GET /v1/schema/search?query=…`, `GET /v1/schema/pages[/<page>]` (no session needed) |

Proven by: `pnpm --filter @aiengineer/service-application exec vitest run src/schema`.

## Gotchas

- The directory is `AIENG_SCHEMA_WORKSPACE_DIR`, else the sibling `../ai-engineer-db-contract/workspace`; with neither,
  every call answers `NOT_AVAILABLE`. `./dev status` shows which workspace and contract version it would read.
- Every answer carries the workspace head (migration head, contract version, fingerprint); when it is older than the
  database being asked about, say so. The service pins a contract version and starts only on a database of that
  release ([database release check](database-release-check.md#pin)), but schema navigation still reads the directory
  above, not the pinned package's copy of the workspace: compare the head with `contract.pinned` in `./dev status`.
