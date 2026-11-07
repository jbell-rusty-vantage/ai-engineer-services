# Architecture

## Call graph

```
 web app ─┐                     ┌─ apps/api (Fastify) ──┐
 CLI ─────┼─ packages/client ──►│  HTTP /v1/...         │
 local MCP┘   (HTTP, ProductPort)└──────────┬───────────┘
                                             ▼
 remote MCP (apps/mcp remote-host) ──► packages/application (ProductService, ProductPort in process)
                                             │
                    ┌────────────────────────┼─────────────────────────┐
                    ▼                        ▼                         ▼
          PostgrestDatabaseGateway   SupabaseObjectStorage      ArtifactCustody
          (caller's session →        (service role, private     (store → read back →
           api.product_command/read)  aieng-workspaces bucket)   hash → complete_asset)
                    └────────────── ai-engineer-db-contract (schema, RLS, functions) ──────────────┘
```

- **In process:** the API and the remote MCP server call `ProductService` directly.
- **Out of process:** the CLI, the local MCP server and the web app call the API through `AiEngineerClient`.
- `ProductPort` is the one interface both sides implement, so `publishSite` and every MCP tool run unchanged on either.

## HTTP API

| Route | Purpose |
| --- | --- |
| `GET /health` | Liveness |
| `GET /v1/operations` | Public operation catalog (name, kind, scope, summary) |
| `POST /v1/commands/:operation` | `{ workspaceId, idempotencyKey, expectedHead?, payload }` → database command result |
| `POST /v1/reads/:operation` | `{ workspaceId?, payload }` → read projection; an empty read is `NOT_FOUND` |
| `POST /v1/assets` | Raw bytes (`application/octet-stream`) + `x-aieng-asset` JSON metadata → verified artifact |

Authentication is `Authorization: Bearer <user session>`; `x-aieng-client-token` carries an optional scoped client
grant. Errors are `{ code, message, detail? }` with the HTTP status from `httpStatusForError`.

## Server-side composites

- **Asset upload:** `register_asset` (as the caller) → store bytes → read back → hash → `complete_asset`. A mismatch
  stays pending and returns `DIGEST_MISMATCH`.
- **Platform manifests:** `freeze_release` and `submit_attempt` return a manifest that the service stores and
  verifies before responding (skipped on idempotent replay).

## MCP tools

The tools are `search_learning`, `read_lesson`, `annotate_lesson_block`, `check_progress`, `draft_work`,
`publish_built_site`, `start_attempt` and `submit_attempt`, plus the Build 07 research tools `propose_research`,
`inspect_research` (acceptance, dataset, statement trace, source usage), `update_dataset` (draft edit or reviewed
proposal), `cite_evidence` and `deliver_output`. Acceptance, delivery decisions and applying dataset changes stay with
people: an agent client receives `FORBIDDEN`. The local stdio server may read folders (`publish_built_site
{directory}`). The remote server accepts only inline files and refuses folders.

## Decisions (Build 06)

| ID | Decision |
| --- | --- |
| S-01 | Separate repository under `aiengineer/`, laid out like Knowledge Services; not inside KS (ADR 0005 boundary) |
| S-02 | In-process transports call the application; out-of-process clients call the HTTP API (KS ADR 0004 pattern) |
| S-03 | The database layer remains the authority; the service validates shapes at the edge and never bypasses RLS |
| S-04 | Byte custody is server-side; clients never receive storage credentials |
| S-05 | MCP tools are task-shaped compositions of catalog operations; local-only work stays in clients |
| S-06 | MCP app disables `exactOptionalPropertyTypes` because SDK transport types do not satisfy it (same as KS) |

## Not built yet

- Login and device flow for the CLI and harness; tokens are currently provided by environment variables.
- OAuth for the remote MCP server.
- A worker app for grading runners, indexing and conversion. The lab script plays the worker.
- Hosting for platform-static sites, and the web app integration.
- Knowledge Services and Mission Control clients.
- Rate limits, request logging and metrics.
- Deployment. Async jobs (long-running operations still run synchronously).
