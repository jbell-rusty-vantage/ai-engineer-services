# Architecture

## Call graph

```
 web app ─┐                     ┌─ apps/api (Fastify) ──┐
 CLI ─────┼─ packages/client ──►│  HTTP /v1/...         │
 local MCP┘   (HTTP, ProductPort)└──────────┬───────────┘
                                             ▼
 remote MCP (apps/mcp remote-host) ──► packages/application (ProductService, ProductPort in process)
                                             │
          ┌──────────────────┬───────────────┼──────────────────┬─────────────────────┐
          ▼                  ▼               ▼                  ▼                     ▼
  PostgrestDatabaseGateway  KnowledgeService  SupabaseObjectStorage  ArtifactCustody   SchemaWorkspace
  (caller's session →       (caller's session → (service role,       (store → read     (files of the generated
   api.product_command/read) api views/functions) private bucket)     back → hash)      schema workspace)
          └──────────────── ai-engineer-db-contract (schema, RLS, functions, workspace/) ───────────────┘
```

- **In process:** the API and the remote MCP server call `ProductService` and `SchemaWorkspace` directly.
- **Out of process:** the CLI, the local MCP server and the web app call the API through `AiEngineerClient`.
- `ProductPort` (operations) and `SchemaPort` (schema navigation) are the interfaces both sides implement, so
  `publishSite` and every MCP tool run unchanged on either.
- `packages/contracts` holds the three catalogs every surface reads: operations (`operations.ts`), the agent-facing
  surface (`surface.ts`: jobs, MCP tools, CLI commands) and the guide (`guide/`).

## HTTP API

| Route | Purpose |
| --- | --- |
| `GET /health` | Liveness |
| `GET /v1/guide`, `GET /v1/guide/:topic` | The start page, or one topic: `{ topic, title, text, topics }` |
| `GET /v1/operations` | Public operation catalog (name, kind, scope, summary) |
| `GET /v1/operations/:name` | One operation's input schema, output shape, example and schema pages (also accepts a tool name) |
| `GET /v1/schema/search?query=&kind=&limit=` | Schema workspace search: `{ head, query, total, results, next }` |
| `GET /v1/schema/pages`, `GET /v1/schema/pages/<path>` | The entry page, or one page: `{ head, page, bytes, truncated, text }` |
| `POST /v1/commands/:operation` | `{ workspaceId, idempotencyKey, expectedHead?, payload }` → database command result |
| `POST /v1/reads/:operation` | `{ workspaceId?, payload }` → read projection; an empty read is `NOT_FOUND` |
| `POST /v1/assets` | Raw bytes (`application/octet-stream`) + `x-aieng-asset` JSON metadata → verified artifact |

Authentication is `Authorization: Bearer <user session>`; `x-aieng-client-token` carries an optional scoped client
grant. The guide, catalog and schema routes read no user data and need no session. Errors are
`{ code, message, detail? }` with the HTTP status from `httpStatusForError`. `NOT_AVAILABLE` (501) means this
deployment cannot answer until something is configured or the database contract changes; `UNAVAILABLE` (503) is
transient.

## Server-side composites

- **Asset upload:** `register_asset` (as the caller) → store bytes → read back → hash → `complete_asset`. A mismatch
  stays pending and returns `DIGEST_MISMATCH`.
- **Platform manifests:** `freeze_release` and `submit_attempt` return a manifest that the service stores and
  verifies before responding (skipped on idempotent replay).

## Knowledge reads

`search_knowledge`, `get_claim`, `get_entity`, `get_source` and `list_due` are catalog operations served by
`packages/application/src/knowledge`, not by `api.product_read`. Each one composes the `api` views and functions of
`ai-engineer-db-contract` through PostgREST with the caller's own session (publishable key plus the caller's token;
never the service key) and returns a compact projection.

| Operation | Database objects (`api` schema) |
| --- | --- |
| `search_knowledge` | `search_unified` (lenses `corpus` and `evidence` only, always passed explicitly; no query embedding, so full text and trigram rank) |
| `get_claim` | `claim_candidates`, `verified_claims`, `claim_verdicts`, `claim_restatements`, `claim_conflicts`, `probe_matrix` |
| `get_entity` | `entity_card` (by id) or `library_dossier` (by library slug) |
| `get_source` | `source_registry`, `source_track_record` |
| `list_due` | `attention_due`, `probe_revalidation_due`, `releases_needing_review`; optional `changes_since`, `modules_affected_by_release` |

**Open database gap (2026-11-15, found by reading the contract; not yet confirmed on the lab stack).** The grants
allow these reads (`authenticated` has `SELECT` and `EXECUTE`), but most of the objects filter on
`util.current_tenant_id()`, which reads the `app.tenant_id` setting. PostgREST requests do not set it, so
`verified_claims`, `claim_candidates`, `claim_conflicts`, `entity_card`, `probe_revalidation_due`,
`releases_needing_review`, `changes_since` and `modules_affected_by_release` return no rows for a signed-in caller
(Build 08 D-82 records the same effect in `psql`). `search_unified` uses the default tenant and is not affected.
Until the schema owner gives authenticated requests a tenant context, `get_claim`, `get_entity` by id and `list_due`
check `api.knowledge_head()` first and answer `NOT_AVAILABLE` instead of an empty result
(`knowledge/tenant-context.ts`); `search_knowledge`, the library dossier and `get_source` read objects without that
filter. Client-grant scopes are enforced inside `api.product_command` and `api.product_read`, so they do not apply
to these reads.

## Schema navigation

`SchemaWorkspace` (`packages/application/src/schema`) reads the generated schema workspace of
`ai-engineer-db-contract`: its `search/index.json` and `search/aliases.json` for a deterministic ranked search, and
page files for `schema_get`. It makes no database call. The directory is `AIENG_SCHEMA_WORKSPACE_DIR`, or the sibling
checkout `../ai-engineer-db-contract/workspace` when it exists; without one the routes and tools answer
`NOT_AVAILABLE`. Every answer carries the workspace head from `fingerprint.json` (migration head, contract version,
fingerprint). A page is capped at 24 KB (cut on a line boundary and marked `truncated`); paths that leave the
workspace are refused; a large JSON file is never returned whole (`search/terminology.json#<term>` returns one key).

## Guide and describe

One source, `packages/contracts/src/guide`: the judgment is prose in `pages.ts`; the lists of tools, commands,
operations, work kinds, value statuses and scopes are generated from the catalogs at request time. `renderGuide`
serves `aieng_guide`, `GET /v1/guide[/topic]` and `aieng guide [topic]`; `describeReference` serves
`aieng_describe`, `GET /v1/operations/:name` and `aieng describe`. Tests keep the start page under 500 estimated
tokens and each topic under 1,200, require every public operation to have a topic, and check that every tool,
operation and CLI command named in a guide page or in the skill exists.

## MCP tools

The 19 tools are declared in the surface catalog (`packages/contracts/src/surface.ts`), which gives each its name,
title and one-line description; the guide and `aieng_describe` carry the depth.

- Start: `aieng_guide`, `aieng_describe`.
- Knowledge: `search_knowledge`, `inspect_knowledge` (claim, entity, source, due).
- Schema: `schema_search`, `schema_get`.
- Learning: `search_learning`, `read_lesson`, `annotate_lesson_block`, `check_progress`, `start_attempt`,
  `submit_attempt`.
- Authoring: `draft_work`, `publish_built_site`.
- Research and datasets: `propose_research`, `inspect_research` (acceptance, dataset, statement trace, source
  usage), `update_dataset` (draft edit or reviewed proposal), `cite_evidence`, `deliver_output`.

Acceptance, delivery decisions and applying dataset changes stay with people: an agent client receives `FORBIDDEN`.
The local stdio server may read folders (`publish_built_site {directory}`). The remote server accepts only inline
files and refuses folders. Text answers (the guide, a schema page) are returned as text; everything else as compact
JSON.

## Decisions (Build 06)

| ID | Decision |
| --- | --- |
| S-01 | Separate repository under `aiengineer/`, laid out like Knowledge Services; not inside KS (ADR 0005 boundary) |
| S-02 | In-process transports call the application; out-of-process clients call the HTTP API (KS ADR 0004 pattern) |
| S-03 | The database layer remains the authority; the service validates shapes at the edge and never bypasses RLS |
| S-04 | Byte custody is server-side; clients never receive storage credentials |
| S-05 | MCP tools are task-shaped compositions of catalog operations; local-only work stays in clients |
| S-06 | MCP app disables `exactOptionalPropertyTypes` because SDK transport types do not satisfy it (same as KS) |

## Decisions (consumer surface, 2026-11-15)

| ID | Decision |
| --- | --- |
| S-07 | Knowledge reads are catalog operations composed in the application from the `api` read surface with the caller's session; no SQL in this repository |
| S-08 | A read that the database cannot answer yet is `NOT_AVAILABLE`, never an empty result |
| S-09 | The knowledge search never reaches the `ours` and `private` lenses; `search` keeps them behind its readability rules |
| S-10 | Tool names and descriptions, CLI commands and the guide come from one surface catalog; the skill only routes to the guide |
| S-11 | Schema navigation is file access to the generated workspace and reports its head in every answer |

## Not built yet

- A tenant context for authenticated PostgREST requests (see Knowledge reads); `fact_locators`, `summary_evidence`,
  `what_changed` and `resolve_entity` are not wired into an operation.
- Lab proof of the knowledge reads, and a semantic channel for `search_knowledge` (it sends no query embedding).
- Login and device flow for the CLI and harness; tokens are currently provided by environment variables.
- OAuth for the remote MCP server.
- A worker app for grading runners, indexing and conversion. The lab script plays the worker.
- Hosting for platform-static sites, and the web app integration.
- Knowledge Services and Mission Control clients.
- Rate limits, request logging and metrics.
- Deployment. Async jobs (long-running operations still run synchronously).
