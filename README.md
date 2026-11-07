# AI Engineer service

The AI Engineer product and knowledge API, its MCP server and the `aieng` CLI. Every surface runs the same product
operations: the database layer in [`ai-engineer-db-contract`](../ai-engineer-db-contract) enforces permissions,
freezing and audit, and this service adds transports, edge validation and server-side byte custody.

**Status (2026-11-05): prototype increment 1 (Build 06) plus the Build 07 research operations** (research requests, editable datasets, statements and evidence; 69 public operations, 13 MCP tools). Proven against a disposable Supabase lab stack, not deployed.
See [architecture](docs/ARCHITECTURE.md) for what exists and what does not.

GitHub: [`jbell-rusty-vantage/ai-engineer-services`](https://github.com/jbell-rusty-vantage/ai-engineer-services) (public). Schema authority: [`jbell-rusty-vantage/agent-engineer-db-contract`](https://github.com/jbell-rusty-vantage/agent-engineer-db-contract).

## Layout

| Package | Name | Role |
| --- | --- | --- |
| `packages/contracts` | `@aiengineer/service-contracts` | Operation catalog, payload schemas, error codes, request shapes, `ProductPort` |
| `packages/application` | `@aiengineer/service-application` | Product use cases over the database gateway, object storage and artifact custody |
| `packages/client` | `@aiengineer/service-client` | Typed HTTP client and site publishing; used by the CLI, the local MCP server and the web app |
| `apps/api` | `@aiengineer/service-api` | HTTP API (Fastify) |
| `apps/mcp` | `@aiengineer/service-mcp` | MCP server: local stdio (harness) and remote streamable HTTP (agents without a sandbox) |
| `apps/cli` | `@aiengineer/service-cli` | `aieng` command line |
| `skills/ai-engineer` | — | Agent skill describing the workflows |

## Run

Requires Node 24 and pnpm 11.

```bash
pnpm install
pnpm build
pnpm test        # unit tests
pnpm lint        # Biome
```

Server processes (API, remote MCP) read `AIENG_DB_URL`, `AIENG_DB_PUBLISHABLE_KEY`, `AIENG_DB_SECRET_KEY` and
`AIENG_DB_PROJECT_REF` (checked against the URL host). The secret key stays in the server process. A git-ignored `.env`
is loaded by the `dev`/`start` scripts; see [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) (also the lab `supabase status` mapping).

```bash
node apps/api/dist/index.js          # http://127.0.0.1:3200  (AIENG_API_HOST / AIENG_API_PORT)
node apps/mcp/dist/remote.js         # http://127.0.0.1:3201/mcp (AIENG_MCP_HOST / AIENG_MCP_PORT)
```

Clients (CLI, local MCP) read `AIENG_API_URL`, `AIENG_ACCESS_TOKEN` (the user's Supabase session) and optionally
`AIENG_CLIENT_TOKEN` (a scoped grant minted with `create_client_grant`).

```bash
node apps/cli/dist/main.js operations
node apps/cli/dist/main.js search "idempotency keys"
node apps/cli/dist/main.js site publish ./dist --workspace <workspace-id>
```

Local MCP server for a harness (`.mcp.json` style):

```json
{ "mcpServers": { "ai-engineer": { "command": "node", "args": ["<repo>/apps/mcp/dist/stdio.js"],
  "env": { "AIENG_API_URL": "http://127.0.0.1:3200", "AIENG_ACCESS_TOKEN": "<session token>" } } } }
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
