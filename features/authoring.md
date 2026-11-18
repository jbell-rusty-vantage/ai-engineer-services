# Authoring, workspaces and reviews

Author a course, module, lesson, activity or artifact as a work with revisions and their structure (parts, outcomes,
requirements, prerequisites, runtime, statements), read it back, mark it ready and hand it to a reviewer; list
workspaces and reviews; upload artifacts and publish a built site. A person, never a tool, records a review decision,
a freeze or an offer.

- Code: `apps/mcp/src/tools/authoring-tools.ts`, `apps/cli/src/authoring-commands.ts`,
  `packages/client/src/site-publisher.ts`; byte custody in `packages/application/src/artifact-custody.ts` and
  `object-storage.ts`; operations in `packages/contracts/src/operations.ts`.
- Tests: `apps/mcp/src/server.test.ts` ("authoring tools", including "no tool reaches the review, freeze and offer
  operations that people decide"); `apps/cli/src/commands.test.ts` ("aieng authoring");
  `packages/contracts/src/guide/guide.test.ts` ("authoring structure").

## Reach it

| Transport | How |
| --- | --- |
| MCP | `draft_work`, `inspect_authoring`, `request_review`, `publish_built_site` |
| CLI | `aieng authoring workspaces`, `structure`, `ready`, `reviews`; `aieng upload`; `aieng site publish`; `aieng command <operation>` |
| HTTP | `POST /v1/commands/<operation>`, `POST /v1/reads/<operation>`, `POST /v1/assets` |

Proven by: `pnpm --filter @aiengineer/service-mcp exec vitest run -t authoring` (offline). On the lab, the consumer
evaluation's authoring flow writes to the loopback lab only (`pnpm eval:consumer-surface`).

## Gotchas

- `list_workspaces`, `get_revision_structure`, `mark_ready_for_review` and `list_reviews` need database contract 0.9.0
  (migration `20261116140000`); without it they answer `NOT_AVAILABLE`.
- The remote MCP server refuses local folders: `publish_built_site` takes base64 files there.
- The method for good content is the `content-authoring` skill (`aieng guide content-authoring`).
