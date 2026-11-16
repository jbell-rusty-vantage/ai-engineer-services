# AI Engineer service

The AI Engineer product and knowledge API, its MCP server and the `aieng` CLI. Every surface runs the same product
operations: the database layer in [`ai-engineer-db-contract`](../ai-engineer-db-contract) enforces permissions,
freezing and audit, and this service adds transports, edge validation and server-side byte custody.

**Status (2026-11-05): prototype increment 1 (Build 06) plus the Build 07 research operations** (research requests, editable datasets, statements and evidence). Proven against a disposable Supabase lab stack, not deployed.

**Consumer surface (2026-11-15):** knowledge reads (`search_knowledge`, `get_claim`, `get_entity`, `get_fact_evidence`, `list_entity_changes`, `get_summary_evidence`, `get_source`, `list_due`), schema navigation, a guide and a describe, on every transport (77 public operations, 19 MCP tools). Unit-tested, and the knowledge reads are proven on the disposable lab stack (not deployed): they need database contract migration `20261115130000` (Build 08 D-82), which gives a signed-in request the deployment's knowledge tenant. Against a database without it they answer `NOT_AVAILABLE`, never an empty result. A client grant needs the `read` scope for them.
**Authoring surface (2026-11-16):** the guide serves the method skills as topics (`content-authoring` with its five references, `ai-engineer-knowledge-charter`), bundled into the built packages; `draft_work` carries a revision's structure (parts, outcomes, requirements with their routes, prerequisites, runtime, statements); `inspect_authoring` reads works, a revision and the exposure preview; `request_review` leaves a hand-over note for the reviewer (77 public operations, 21 MCP tools). Unit-tested; the lab result of the authoring flow is in the consumer evaluation scorecard. Not deployed.
**Read-back and hand-over (2026-11-16, later):** `list_workspaces`, `get_revision_structure`, `mark_ready_for_review` and `list_reviews` (database contract 0.9.0, migration `20261116140000`) through `inspect_authoring`, `request_review` and `aieng authoring workspaces|structure|ready|reviews` (81 public operations, still 21 MCP tools). Unit-tested and proven on the disposable lab stack by the consumer evaluation; not deployed. Against a database without that migration the service answers them `NOT_AVAILABLE` (the database says `UNKNOWN_OPERATION`).
See [architecture](docs/ARCHITECTURE.md) for what exists and what does not.

GitHub: [`jbell-rusty-vantage/ai-engineer-services`](https://github.com/jbell-rusty-vantage/ai-engineer-services) (public). Schema authority: [`jbell-rusty-vantage/agent-engineer-db-contract`](https://github.com/jbell-rusty-vantage/agent-engineer-db-contract).

## Layout

| Package | Name | Role |
| --- | --- | --- |
| `packages/contracts` | `@aiengineer/service-contracts` | Operation catalog, payload schemas, error codes, request shapes, `ProductPort`; the surface catalog (jobs, MCP tools, CLI commands) and the guide |
| `packages/application` | `@aiengineer/service-application` | Product use cases over the database gateway, knowledge reads, schema navigation, object storage and artifact custody |
| `packages/client` | `@aiengineer/service-client` | Typed HTTP client and site publishing; used by the CLI, the local MCP server and the web app |
| `apps/api` | `@aiengineer/service-api` | HTTP API (Fastify) |
| `apps/mcp` | `@aiengineer/service-mcp` | MCP server: local stdio (harness) and remote streamable HTTP (agents without a sandbox) |
| `apps/cli` | `@aiengineer/service-cli` | `aieng` command line |
| `skills/ai-engineer` | — | Agent skill: a short router to the guide |
| `skills/content-authoring` | — | Method skill: verified knowledge into a course, module, lesson, activity and artifact (`SKILL.md`, `references/`); `SOURCES.md` is its provenance record and is not served |
| `skills/ai-engineer-knowledge-charter` | — | Method skill: what the knowledge base is for, source tiers, repository and paper rules |

## Where an agent starts

One guide, the same text on every transport: the MCP tool `aieng_guide`, `aieng guide [topic]` and
`GET /v1/guide[/topic]`. It lists the jobs (find knowledge, read a claim or source, see what is due, navigate the
schema, author content, request research, work with datasets, study and practise) and the tool or command for each.
`aieng_describe`, `aieng describe <operation>` and `GET /v1/operations/<operation>` give one operation's input
schema, output shape and an example.

The same guide serves the skills, for an agent that has the MCP server and no files: a skill name is a topic
(`aieng guide content-authoring`), and so is each reference (`aieng guide content-authoring/references/lesson-craft`,
`GET /v1/guide/content-authoring/references/lesson-craft`). The start page lists them with their descriptions. The
Markdown under `skills/` is the one source: `pnpm build` inlines it into `packages/contracts/dist`, so no server reads
the checkout at run time.

## Run

Requires Node 24 and pnpm 11.

```bash
pnpm install
pnpm build
pnpm test        # unit tests
pnpm lint        # Biome
```

Server processes (API, remote MCP) read `AIENG_DB_URL`, `AIENG_DB_PUBLISHABLE_KEY`, `AIENG_DB_SECRET_KEY` and
`AIENG_DB_PROJECT_REF` (checked against the URL host). The secret key stays in the server process. Schema navigation
reads the generated schema workspace at `AIENG_SCHEMA_WORKSPACE_DIR` (default: the sibling checkout
`../ai-engineer-db-contract/workspace`). A git-ignored `.env` is loaded by the `dev`/`start` scripts; see
[docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) (also the lab `supabase status` mapping).

```bash
node apps/api/dist/index.js          # http://127.0.0.1:3200  (AIENG_API_HOST / AIENG_API_PORT)
node apps/mcp/dist/remote.js         # http://127.0.0.1:3201/mcp (AIENG_MCP_HOST / AIENG_MCP_PORT)
```

Clients (CLI, local MCP) read `AIENG_API_URL`, `AIENG_ACCESS_TOKEN` (the user's Supabase session) and optionally
`AIENG_CLIENT_TOKEN` (a scoped grant minted with `create_client_grant`). `aieng guide` and `aieng describe` need
neither.

```bash
node apps/cli/dist/main.js guide
node apps/cli/dist/main.js knowledge search "structured output retries" --lens evidence
node apps/cli/dist/main.js schema search "verified claims"
node apps/cli/dist/main.js search "idempotency keys"
node apps/cli/dist/main.js site publish ./dist --workspace <workspace-id>
```

Local MCP server for a harness (`.mcp.json` style):

```json
{ "mcpServers": { "ai-engineer": { "command": "node", "args": ["<repo>/apps/mcp/dist/stdio.js"],
  "env": { "AIENG_API_URL": "http://127.0.0.1:3200", "AIENG_ACCESS_TOKEN": "<session token>" } } } }
```

## Consumer evaluation

A deterministic scorecard of the questions an agent comes with, asked through the MCP path, the HTTP path and the
CLI: is the tool there, described and typed; is the answer non-empty and small; do the guide and the skills name only
tools, operations and commands that exist. It builds the API and the remote MCP server in process on loopback ports
and writes `lab-results/consumer-surface.json`. Every check is read-only except the authoring flow (a module with two
lessons and an activity, a section bound to a verified claim, read back, handed over), which runs only against the
loopback lab stack as a lab user created for it and removes nothing.

```bash
pnpm build
pnpm eval:consumer-surface --without-database   # guide, skills, describe and schema checks; knowledge and authoring flow not run
pnpm eval:consumer-surface                      # with the lab stack's AIENG_DB_* exported (docs/ENVIRONMENT.md)
```

## Lab proofs

With the disposable lab stack running (created from `ai-engineer-db-contract`; the BellLabs workspace record is `platform/ai-engineer-research-2026-11-02/10-review-workspace/reviews/BUILD-06-SERVICE-SURFACES.md`, which is not part of this repository):

```bash
# product schema journey through the API (150 checks; 5 storage-boundary checks run on the database surface)
# the Build 07 research journey reads fetched sources from <lab>/sources/2026-11-05 (PRODUCT_LAB_SOURCES)
PRODUCT_LAB_WORKDIR=<lab> PRODUCT_LAB_SURFACE=api python -I ../ai-engineer-db-contract/scripts/product-lab/run_lab.py
# local MCP, remote MCP and CLI as real processes (17 checks)
AIENG_API_URL=http://127.0.0.1:3200 pnpm lab:prove-surfaces
```
