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
| `GET /v1/guide`, `GET /v1/guide/<topic>` | The start page, one topic, or one skill page (`<skill>` or `<skill>/references/<name>`): `{ topic, title, text, topics }` |
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

`search_knowledge`, `get_claim`, `get_entity`, `get_fact_evidence`, `list_entity_changes`, `get_summary_evidence`,
`get_source` and `list_due` are catalog operations served by `packages/application/src/knowledge`, not by
`api.product_read`. Each one composes the `api` views and functions of `ai-engineer-db-contract` through PostgREST
with the caller's own session (publishable key plus the caller's token; never the service key) and returns a compact
projection.

| Operation | Database objects (`api` schema) |
| --- | --- |
| `search_knowledge` | `search_knowledge` (lenses `corpus` and `evidence` only, no workspace parameter; no query embedding is sent, so full text and trigram rank) |
| `get_claim` | `claim_candidates`, `verified_claims`, `claim_verdicts`, `claim_restatements`, `claim_conflicts`, `probe_matrix` |
| `get_entity` | `entity_card` (by id) or `library_dossier` (by library slug) |
| `get_fact_evidence` | `fact_locators` |
| `list_entity_changes` | `what_changed`, `knowledge_head` (the default upper sequence) |
| `get_summary_evidence` | `summary_evidence` |
| `get_source` | `source_registry`, `source_track_record` |
| `list_due` | `attention_due`, `probe_revalidation_due`, `releases_needing_review`; optional `changes_since`, `modules_affected_by_release` |

**Tenant context (database contract migration `20261115130000`, Build 08 D-82).** Most of these objects filter on
`util.current_tenant_id()`. PostgREST cannot set `app.tenant_id`, so before that migration they returned no rows to a
signed-in caller. The migration resolves a signed-in request to the deployment's tenant, and the reads answer;
`anon` still reads nothing. The service keeps one safeguard for a database without the migration (or with nothing
ingested): when a tenant-scoped read comes back empty, it asks `api.knowledge_head()`; sequence 0 turns the answer into
`NOT_AVAILABLE` instead of `NOT_FOUND` or "nothing due" (`knowledge/tenant-context.ts`). A read that finds its rows
makes no extra call.

**Search scope.** `api.search_unified` takes the private scope from its caller (`p_workspace_ids`), so the same
migration made it non-executable for `anon` and `authenticated`: before it, any caller could read another workspace's
private passages by passing its id. `search_knowledge` calls `api.search_knowledge`, which has no workspace parameter
and refuses every lens but `corpus` and `evidence`. Private notes and released course material stay behind the product
`search` operation, where `api.product_read` derives the scope from the caller's identity.

**Client grants.** `api.product_command` and `api.product_read` check a presented client grant inside the database. The
knowledge reads do not pass through them, so `ProductService` asks for the same check first, through
`api.product_scope(<scope>)` with the operation's scope from the catalog (`read`), whenever the request carries a client
token: a grant without the scope is `CLIENT_SCOPE_DENIED`, a revoked or foreign one `CLIENT_GRANT_INVALID`. A request
without a client token is not narrowed, as everywhere else.

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
`aieng_describe`, `GET /v1/operations/:name` and `aieng describe`. Tests keep the start page under 750 estimated
tokens, each topic under 1,400 and each skill page under 2,800, require every public operation to have a topic, and
check that every tool, operation and CLI command named in a guide page or in a skill page exists.

**Skills.** `skills/` is the second source the guide serves. Each `SKILL.md` is the topic named after its folder and
each file under `references/` the topic `<skill>/references/<name>`; the answer is the file's own Markdown. The start
page lists the method skills with the description from their frontmatter (the router skill `ai-engineer` is served
but not listed: it is the on-disk copy of the start page). `guide/skill-files.ts` imports each page; the contracts
build inlines them as text (`tsup --loader .md=text`, the same transform in `vitest.config.ts`), so the API, the CLI
and both MCP servers carry the pages in `@aiengineer/service-contracts` and read no file at run time. An operational
topic that overlaps a skill (authoring, knowledge, research) stays the short page of operations and tools and opens
with a link to the skill.

## MCP tools

The 21 tools are declared in the surface catalog (`packages/contracts/src/surface.ts`), which gives each its name,
title and one-line description; the guide and `aieng_describe` carry the depth.

- Start: `aieng_guide`, `aieng_describe`.
- Knowledge: `search_knowledge`, `inspect_knowledge` (claim, entity, fact evidence, entity changes, summary evidence,
  source, due).
- Schema: `schema_search`, `schema_get`.
- Learning: `search_learning`, `read_lesson`, `annotate_lesson_block`, `check_progress`, `start_attempt`,
  `submit_attempt`.
- Authoring: `draft_work` (a work or a new revision with its body, bindings and structure: parts, outcomes,
  requirements with their routes, prerequisites, runtime, statements), `inspect_authoring` (the workspaces you belong
  to, a workspace's works, one work or revision with its saved structure, the exposure preview, a hand-over
  conversation, review requests and feedback), `request_review` (the exposure preview, a hand-over note in a workspace
  conversation tied to the revision, the ready-for-review mark, optionally a delivery against a research obligation),
  `publish_built_site`.
- Research and datasets: `propose_research`, `inspect_research` (acceptance, dataset, statement trace, source
  usage), `update_dataset` (draft edit or reviewed proposal), `cite_evidence`, `deliver_output`.

Acceptance, delivery decisions, human reviews and applying dataset changes stay with people: an agent client receives
`FORBIDDEN` from the database, and no tool calls those operations (`request_review` records no review). `read_lesson`
renders any revision the caller can read, whatever the work kind (`get_lesson_view` has no kind check); it does not
follow parts.
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
| S-12 | The tenant-context check runs only when a tenant-scoped read is empty: it decides between `NOT_AVAILABLE` and `NOT_FOUND` or "nothing due", and costs a found read nothing (2026-11-16) |
| S-13 | A request that carries a client token passes `api.product_scope` with the operation's catalog scope before any knowledge read (2026-11-16) |

## Decisions (authoring surface, 2026-11-16)

| ID | Decision |
| --- | --- |
| S-14 | The skills folder is a guide source: one Markdown text per page, inlined at build time, served unchanged on every transport |
| S-15 | `draft_work` was extended instead of given a sibling: one job, the same two operations, optional structure fields; the edge schema of `create_work` and `revise_work` describes each structure shape |
| S-16 | `inspect_authoring` composes the existing reads; it says in every revision answer what no read returns |
| S-17 | A hand-over is the exposure preview plus a note in a workspace conversation tied to the exact revision (and a delivery when a brief asked for the work); no tool records a review |
| S-18 | The four authoring reads and the hand-off were added to existing tools (`inspect_authoring`, `request_review`), not as new tools; the database owns them as product operations (contract 0.9.0), and a revision answer carries the saved structure instead of naming what is missing |
| S-19 | A Markdown schema page asked for with an anchor returns that entry (a table row with its header, or a section); the query catalog page outgrew the page cap at contract 0.7.0 |

## Authoring read-back and hand-over (database contract 0.9.0, 2026-11-16)

Four product operations, dispatched in the database by `product.dispatch_authoring_read` and
`product.dispatch_authoring_command` through the same `api.product_read` / `api.product_command` (migration
`20261116140000`); the service adds only catalog rows, edge schemas, guide text, CLI commands and the two tools' use.

| Operation | What it answers | Who sees what |
| --- | --- | --- |
| `list_workspaces` | the caller's memberships: role, canWrite, owned | own memberships only; a client grant naming workspaces narrows it |
| `get_revision_structure` | bindings, parts (with childIsHead), outcomes, requirements with routes, prerequisites, runtime, statements | members of the revision's workspace; others `NOT_FOUND` |
| `mark_ready_for_review` | a `revision_proposed` event with the closure the database computes, the note and the thread | owner or editor; idempotent per revision and ceiling; records no review |
| `list_reviews` | requests with status (awaiting_review, reviewed by a person, superseded), reviews since, replies after the note | members (readers included) of the workspace |

`inspect_authoring` uses the first, second and fourth (what "workspace", "work"/"revision", "reviews"); `request_review`
calls the third after the note. The CLI has `aieng authoring workspaces|structure|ready|reviews`. Status "reviewed"
counts a person's review only (actor kind human); an agent's own review of a non-human type is listed as an agent's.

A statement that names the shared claim it restates was refused with `NOT_FOUND: cited shared claim` until database
contract 0.8.0 gave `product_api_owner` a tenant-scoped read policy on `evidence.claim`; it is accepted now, and another
tenant's claim is refused (suite `authoring_review_reads`).

Still missing: a writer for `feedback` events (a person's feedback is a recorded review or a reply), feedback on an exact
block, withdrawing a request.

## Not built yet

- `resolve_entity` is not wired into an operation (an entity id comes from a search hit or a dossier).
- `get_summary_evidence` is unit-tested only: the lab holds no document summary to read back.
- A semantic channel for `search_knowledge` (it sends no query embedding).
- Login and device flow for the CLI and harness; tokens are currently provided by environment variables.
- OAuth for the remote MCP server.
- A worker app for grading runners, indexing and conversion. The lab script plays the worker.
- Hosting for platform-static sites, and the web app integration.
- Knowledge Services and Mission Control clients.
- Rate limits, request logging and metrics.
- Deployment. Async jobs (long-running operations still run synchronously).
