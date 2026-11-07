# AI Engineer service — agent guide

Read `../AGENTS.md` (AI Engineer domain) and `../../AGENTS.md` (BellLabs) first. Start with [README](README.md) and
[architecture](docs/ARCHITECTURE.md).

## Ownership

- This repository owns AI Engineer product transports: HTTP API, MCP server, CLI, typed client and the agent skill.
- Schema, migrations, database functions (`api.product_command`, `product_read`, `product_worker`) and generated
  types belong to `../ai-engineer-db-contract`. Never add tables, policies or SQL authority here.
- Knowledge capabilities (retrieval, conversion, verification) belong to `../../platform/knowledge-services`; call
  its published HTTP client, never its internal packages. Missions belong to `../../platform/mission-control`.
- `../ai-engineer-web` is a client of this API (through `@aiengineer/service-client`); do not put product logic there.

## Rules

- One operation catalog (`packages/contracts/src/operations.ts`). HTTP routes, MCP tools and CLI commands are derived
  from it or call it; never re-declare an operation elsewhere.
- In-process transports (API, remote MCP) call `packages/application`. Out-of-process clients (CLI, local MCP, web)
  use `packages/client`. Both implement `ProductPort`, so MCP tools are written once.
- MCP tools are task-shaped and few (currently 13). Add a tool only for a real agent workflow; compose existing
  operations. New business logic goes into the database layer or `packages/application` first, so every surface
  gets it. Only local-machine work (reading a folder, packaging files) may live in a client.
- Every user call runs with the caller's own Supabase session so row security and grants apply. The service-role
  key is used only for byte custody (storage + `complete_asset`) after a user-authorized registration.
- Errors use the shared `ProductErrorCode` vocabulary and `{ code, message, detail? }` bodies on every surface.
- Naming: packages `@aiengineer/service-*`; files kebab-case; operations and tools snake_case; classes PascalCase;
  no abbreviations in public names. Keep modules small and single-purpose; prefer explicit types at boundaries.

## Validate

```bash
pnpm build && pnpm typecheck && pnpm test && pnpm lint
```

End-to-end proofs need the disposable lab stack; see README. Report results as implemented / tested / integrated /
qualified, never as deployed unless a deployment was actually verified.

## Environment

Database variables are `AIENG_DB_URL`, `AIENG_DB_PUBLISHABLE_KEY`, `AIENG_DB_SECRET_KEY` and `AIENG_DB_PROJECT_REF`, read only by `packages/application/src/config.ts` (no aliases).
Local scripts load a git-ignored `.env` via `--env-file-if-exists`; never print or commit values.
Service/client variables (`AIENG_API_*`, `AIENG_MCP_*`, `AIENG_ACCESS_TOKEN`, `AIENG_CLIENT_TOKEN`) are registered too.
Registry and lab mapping: `config/env.registry.yaml`, `docs/ENVIRONMENT.md`. This repository is public (`jbell-rusty-vantage/ai-engineer-services`).
