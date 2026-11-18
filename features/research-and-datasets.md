# Research and datasets

Request research, read its state, cite evidence, edit a dataset and deliver an output. Accepting research, deciding a
delivery and deciding a dataset change are a person's decisions; no tool makes them.

- Code: `apps/mcp/src/tools/research-tools.ts`; payload schemas in `packages/contracts/src/payloads.ts`; operations in
  `packages/contracts/src/operations.ts`.
- Tests: `apps/mcp/src/server.test.ts` ("maps research tools onto catalog operations");
  `packages/contracts/src/operations.test.ts` ("validates research payloads at the edge").

## Reach it

| Transport | How |
| --- | --- |
| MCP | `propose_research`, `inspect_research`, `update_dataset`, `cite_evidence`, `deliver_output` |
| CLI | `aieng command <operation>`, `aieng read <operation>` (how-to: `aieng guide research`, `aieng guide datasets`) |
| HTTP | `POST /v1/commands/<operation>`, `POST /v1/reads/<operation>` |

Proven by: `pnpm --filter @aiengineer/service-mcp exec vitest run -t research`.

## Gotchas

- The unit tests check the tool-to-operation mapping and edge validation only. On the lab, `pnpm lab:prove-surfaces`
  proposes research and reads its status through the local MCP server (needs the lab and a running API); the consumer
  scorecard does not cover research.
