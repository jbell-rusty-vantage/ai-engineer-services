# AI Engineer service — agent guide

Read `../AGENTS.md` (AI Engineer domain) and `../../AGENTS.md` (BellLabs) first. Start with [README](README.md) and
[architecture](docs/ARCHITECTURE.md).

## Ownership

- This repository owns AI Engineer product transports: HTTP API, MCP server, CLI, typed client and the agent skills.
- Schema, migrations, database functions (`api.product_command`, `product_read`, `product_worker`), the `api` read
  views and functions, the generated schema workspace and generated types belong to `../ai-engineer-db-contract`.
  Never add tables, policies or SQL authority here.
- Knowledge capabilities (retrieval, conversion, verification) belong to `../../platform/knowledge-services`; call
  its published HTTP client, never its internal packages. Missions belong to `../../platform/mission-control`.
- `../ai-engineer-web` is a client of this API (through `@aiengineer/service-client`); do not put product logic there.

## Rules

- One operation catalog (`packages/contracts/src/operations.ts`). HTTP routes, MCP tools and CLI commands are derived
  from it or call it; never re-declare an operation elsewhere.
- One surface catalog (`packages/contracts/src/surface.ts`): the jobs, the MCP tool names with their one-line
  descriptions, and the CLI commands. The MCP server, the CLI usage text and the guide read it. A new tool or command
  needs an entry there; a new operation needs a guide topic (`guide/operation-topics.ts`). Tests enforce both.
- The guide (`packages/contracts/src/guide`) is the one place for operational how-to: which operation or tool does a
  step. `skills/` holds the method: `ai-engineer` only routes to the guide, `content-authoring` and
  `ai-engineer-knowledge-charter` say how to do the work well. The guide serves every `SKILL.md` and every file under
  a skill's `references/` as a topic, on every transport. A new skill page needs its import line in
  `guide/skill-files.ts`; the build inlines the Markdown and a test fails when the list and the folder differ.
- A skill names a tool and says when to use it. It never restates arguments (those come from `aieng_describe`) and
  never names a database schema, table or column. What exists today is said once, in the skill's Availability section.
- In guide pages and skill pages a code span starts with a tool or operation name, starts with `aieng`, or is a
  literal, so the test that every named tool, operation and command exists stays mechanical.
- In-process transports (API, remote MCP) call `packages/application`. Out-of-process clients (CLI, local MCP, web)
  use `packages/client`. Both implement `ProductPort` (and `SchemaPort`), so MCP tools are written once.
- MCP tools are task-shaped and few (currently 21). Add a tool only for a real agent workflow; compose existing
  operations. New business logic goes into the database layer or `packages/application` first, so every surface
  gets it. Only local-machine work (reading a folder, packaging files) may live in a client. No tool calls an
  operation that records a person's decision (`review_revision`, `freeze_release`, `offer_release`, `accept_research`,
  `decide_delivery`, `decide_dataset_change`); a test keeps it so.
- Every user call runs with the caller's own Supabase session so row security and grants apply. The service-role
  key is used only for byte custody (storage + `complete_asset`) after a user-authorized registration. Knowledge
  reads (`packages/application/src/knowledge`) read the `api` views and functions as the caller, too.
- Errors use the shared `ProductErrorCode` vocabulary and `{ code, message, detail? }` bodies on every surface. A
  read the deployment cannot answer yet is `NOT_AVAILABLE`, never an empty result.
- Naming: packages `@aiengineer/service-*`; files kebab-case; operations and tools snake_case; classes PascalCase;
  no abbreviations in public names. Keep modules small and single-purpose; prefer explicit types at boundaries.

## Validate

```bash
pnpm build && pnpm typecheck && pnpm test && pnpm lint
pnpm eval:consumer-surface --without-database   # consumer scorecard, no database needed
```

End-to-end proofs need the disposable lab stack; see README. Report results as implemented / tested / integrated /
qualified, never as deployed unless a deployment was actually verified.

## Environment

Database variables are `AIENG_DB_URL`, `AIENG_DB_PUBLISHABLE_KEY`, `AIENG_DB_SECRET_KEY` and `AIENG_DB_PROJECT_REF`, read only by `packages/application/src/config.ts` (no aliases).
Local scripts load a git-ignored `.env` via `--env-file-if-exists`; never print or commit values.
Service/client variables (`AIENG_API_*`, `AIENG_MCP_*`, `AIENG_ACCESS_TOKEN`, `AIENG_CLIENT_TOKEN`, `AIENG_SCHEMA_WORKSPACE_DIR`) are registered too.
Registry and lab mapping: `config/env.registry.yaml`, `docs/ENVIRONMENT.md`. This repository is public (`jbell-rusty-vantage/ai-engineer-services`).
