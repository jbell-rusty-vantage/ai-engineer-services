# Learning and attempts

Study and practise: search the learner's own material and the released course material, read a lesson with private
notes, annotate a block, check progress, start an attempt with an honest facet and submit frozen evidence.

- Code: `apps/mcp/src/tools/learning-tools.ts`, `apps/mcp/src/tools/attempt-tools.ts`; operations in
  `packages/contracts/src/operations.ts`; the how-to is the guide topic `learning`.
- Tests: catalog level only: `packages/contracts/src/guide/guide.test.ts` ("surface catalog", "guide topics") and
  `apps/mcp/src/server.test.ts` ("exactly the surface catalog").

## Reach it

| Transport | How |
| --- | --- |
| MCP | `search_learning`, `read_lesson`, `annotate_lesson_block`, `check_progress`, `start_attempt`, `submit_attempt` |
| CLI | `aieng search <query>`, `aieng command <operation>`, `aieng read <operation>` |
| HTTP | `POST /v1/commands/<operation>`, `POST /v1/reads/<operation>` |

Proven by: `node apps/cli/dist/main.js guide learning` (the how-to and its tools, offline). The lab proof
`pnpm lab:prove-surfaces` enrolls a learner through the remote MCP server (needs the lab and a running API).

## Gotchas

- Course maintainers, not agents, finalize results, resolve appeals and decide equivalence.
- No tool-level unit test covers these tools yet; a change here is proven on the lab.
