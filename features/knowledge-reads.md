# Knowledge reads

Search the verified knowledge base and read one claim, entity, source, fact stream, a summary's evidence, an entity's
changes, or what is due for review. Every read runs as the signed-in caller against the database contract's `api` views
and functions, in the deployment's knowledge tenant.

- Operations: `search_knowledge`, `get_claim`, `get_entity`, `get_fact_evidence`, `list_entity_changes`,
  `get_summary_evidence`, `get_source`, `list_due` (catalogued in `packages/contracts/src/operations.ts`, shapes in
  `packages/contracts/src/knowledge.ts`).
- Code: `packages/application/src/knowledge/` (one reader per operation; `knowledge-database.ts` talks to PostgREST).
- Tests: `packages/application/src/knowledge/knowledge-service.test.ts`; transport cases in `apps/api/src/server.test.ts`
  ("knowledge reads"), `apps/mcp/src/server.test.ts` ("knowledge tools"), `apps/cli/src/commands.test.ts`
  ("aieng knowledge").

## Reach it

| Transport | How |
| --- | --- |
| MCP | `search_knowledge`; `inspect_knowledge` (claim, entity, source, due, fact evidence, summary evidence, changes) |
| CLI | `aieng knowledge search`, `claim`, `entity`, `facts`, `changes`, `summary`, `source`, `due` |
| HTTP | `POST /v1/reads/<operation>` with the caller's bearer token |

Proven by: `pnpm --filter @aiengineer/service-application exec vitest run src/knowledge` (offline). On the lab:
`pnpm eval:consumer-surface` (needs the lab running and `.env.lab`).

## Gotchas

- They need database contract migration `20261115130000` (Build 08 D-82); a database without it answers
  `NOT_AVAILABLE`, never an empty result.
- A client grant needs the `read` scope.
- The search lenses are `corpus` and `evidence` only.
