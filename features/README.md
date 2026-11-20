# Feature map

What a user of this service (an agent with the MCP server, an agent with the `aieng` CLI, the web app, John) can
reach, one file per capability. Each file says what it does, where its code and tests are, how to reach it, the command
that proves it, and its gotchas. Code is the authority; these files are navigation (SPEC-03 K5, OVE-243). Start every
session with `./dev status`; the fast gate for any change is `./dev check`.

Every capability runs the same operations on three transports, so a capability file names its MCP tools, CLI commands
and HTTP routes, and the transport files say how each transport works.

| Feature | Reach it with | Proven by |
| --- | --- | --- |
| [Knowledge reads](knowledge-reads.md) | `search_knowledge`, `inspect_knowledge`; `aieng knowledge …` | `pnpm --filter @aiengineer/service-application exec vitest run src/knowledge` |
| [Schema navigation](schema-navigation.md) | `schema_search`, `schema_get`; `aieng schema …`; `GET /v1/schema/…` | `pnpm --filter @aiengineer/service-application exec vitest run src/schema` |
| [Guide and describe](guide-and-describe.md) | `aieng_guide`, `aieng_describe`; `aieng guide`, `aieng describe`; `GET /v1/guide` | `node apps/cli/dist/main.js guide` |
| [Authoring, workspaces and reviews](authoring.md) | `draft_work`, `inspect_authoring`, `request_review`, `publish_built_site`; `aieng authoring …` | `pnpm --filter @aiengineer/service-mcp exec vitest run -t authoring` |
| [Research and datasets](research-and-datasets.md) | `propose_research`, `inspect_research`, `update_dataset`, `cite_evidence`, `deliver_output` | `pnpm --filter @aiengineer/service-mcp exec vitest run -t research` |
| [Learning and attempts](learning.md) | `search_learning`, `read_lesson`, `annotate_lesson_block`, `check_progress`, `start_attempt`, `submit_attempt` | `node apps/cli/dist/main.js guide learning` |
| [HTTP API](http-api.md) | `apps/api`, port 3200 | `pnpm --filter @aiengineer/service-api test` |
| [MCP server](mcp-server.md) | `apps/mcp`: stdio for a harness, streamable HTTP on port 3201 | `pnpm --filter @aiengineer/service-mcp test` |
| [CLI](cli.md) | `aieng` (`apps/cli`) | `pnpm --filter @aiengineer/service-cli test` |
| [Database target](database-target.md) | `.env.lab` by default; a remote only with `AIENG_DB_REMOTE_CONFIRM`; `./dev planes`, `./dev db` | `pnpm --filter @aiengineer/service-application exec vitest run src/config.test.ts` |
| [Database release check](database-release-check.md) | `GET /health` (`databaseRelease`) on the API and the remote MCP server; `AIENG_DB_RELEASE_CHECK`; `./dev status` (`contract.pinned`) | `pnpm --filter @aiengineer/service-application exec vitest run src/database-release.test.ts` |
| [Provenance](provenance.md) | `./dev trace show`, `check`, `build`; the commit-msg hook | `./dev trace check` |

Across all of them, `./dev test surface` builds and runs the consumer scorecard without a database
(`scripts/consumer-surface-eval.ts`). The proofs against the lab stack (`pnpm lab:prove-surfaces`,
`pnpm eval:consumer-surface`) need the lab running and are never part of `./dev check` or CI.
