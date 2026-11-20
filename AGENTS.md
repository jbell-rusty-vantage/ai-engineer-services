# AI Engineer service: agent guide

The AI Engineer product API, MCP server (stdio and remote HTTP), `aieng` CLI, typed client and agent skills, over the
schema of `../ai-engineer-db-contract`. Read `../AGENTS.md` and `../../AGENTS.md` first. Proven on the disposable lab
stack only, not deployed. Map of what a user can reach: [features](features/README.md); design:
[architecture](docs/ARCHITECTURE.md); variables: [environment](docs/ENVIRONMENT.md).

## Commands

```sh
./dev status        # orient (JSON): branch, ahead/behind, dirty, contract pinned, database target, local services
./dev check         # the fast gate: pnpm typecheck, pnpm test, pnpm lint, planes check, provenance (warn-only)
./dev trace check   # provenance gaps since the 2026-11-18 cutover
```

Also `./dev doctor`, `./dev test unit|surface`, `./dev hooks install`, `./dev planes list|show|check` and
`./dev db status|schema|query --plane P` (read-only; `--plane` always required). PowerShell: `.\dev`.

## Boundaries, each with its check

| Boundary | Enforced by |
| --- | --- |
| Schema, migrations, database functions, `api` views, the schema workspace and generated types belong to `../ai-engineer-db-contract`; no tables, policies or SQL authority here | review; no SQL in this repository |
| One operation catalog, `packages/contracts/src/operations.ts`; routes, tools and commands derive from it | `operations.test.ts` |
| One surface catalog, `packages/contracts/src/surface.ts` (jobs, MCP tools, CLI commands); a new operation needs a guide topic (`guide/operation-topics.ts`) | `guide.test.ts` "surface catalog", "guide topics"; `apps/mcp/src/server.test.ts` "exactly the surface catalog" |
| The guide is the one place for how-to; skills hold method, name only real tools, never a schema, table or column ([rules](features/guide-and-describe.md#skills)) | `guide.test.ts` "the agent skill", "skills in the guide" |
| MCP tools are few and task-shaped (21); none calls a person's decision (`review_revision`, `freeze_release`, `offer_release`, `accept_research`, `decide_delivery`, `decide_dataset_change`) | `server.test.ts`; `guide.test.ts` "keeps the review decisions people make out of every tool" |
| In-process transports (API, remote MCP) call `packages/application`; out-of-process clients (CLI, local MCP, web) use `packages/client`; both implement `ProductPort` and `SchemaPort` | `pnpm typecheck` |
| Every user call runs with the caller's own Supabase session; the secret key only for byte custody, worker calls and the release read at startup | `knowledge-service.test.ts` "PostgrestKnowledgeDatabase" (caller's bearer; the release read); `apps/api/src/server.test.ts` |
| The contract is pinned as a package (`vendor/`); the API and the remote MCP server start only on the database release it names, read from the package and never written in source; `AIENG_DB_RELEASE_CHECK` changes the mode ([release check](features/database-release-check.md)) | `database-release.test.ts` (the contract's shared cases); "database release check" in `apps/api/src/server.test.ts` and `apps/mcp/src/remote-host.test.ts` |
| Errors are `{ code, message, detail? }` with `ProductErrorCode`; a read the deployment cannot answer is `NOT_AVAILABLE`, never empty | `operations.test.ts` "maps every error code"; `product-service.test.ts` "answers NOT_AVAILABLE" |
| Local by default: scripts load only `.env.lab` (loopback lab); a remote needs `AIENG_DB_REMOTE_CONFIRM=<project ref>`; lab scripts refuse any remote | `config.test.ts`; `./dev status` `database_target` |
| Database names are read only by `packages/application/src/config.ts`; every variable is registered | `config/env.registry.yaml`, [environment](docs/ENVIRONMENT.md) |
| Knowledge capabilities belong to `../../platform/knowledge-services` (its HTTP client only); missions to `../../platform/mission-control`; `../ai-engineer-web` is a client, no product logic there | review |
| Every commit ends with `Refs:` (OVE-n, B08-S<n>, D-<n>, AS-S<n>, ADR-NNNN), and `Decisions:` / `Docs:` when they apply | commit-msg hook and CI `provenance` job, warn-only ([provenance](features/provenance.md)) |
| The fast gate passes on Linux | `.github/workflows/ci.yml` runs `./dev check` |

## Rules

- New business logic goes into the database layer or `packages/application` first, so every surface gets it; only
  local-machine work (reading a folder, packaging files) may live in a client.
- Naming: packages `@aiengineer/service-*`; files kebab-case; operations and tools snake_case; classes PascalCase; no
  abbreviations in public names.
- This repository is public (`jbell-rusty-vantage/ai-engineer-services`): never print or commit `.env*` values,
  tokens or lab receipts. Never write the Aura graph `4773dc72` (`./dev planes` refuses it).
- End-to-end proofs (`pnpm lab:prove-surfaces`, `pnpm eval:consumer-surface`) need the lab stack and a running API;
  report implemented / tested / integrated / qualified, never deployed without a verified deployment.
