# Guide and describe

One guide, the same text on every transport: the jobs an agent comes with, the tool or command for each, a how-to per
topic, and the method skills under `skills/` served as topics. `describe` gives one operation's input schema, output
shape and a valid example.

- Code: `packages/contracts/src/guide/` (`pages.ts`, `operation-topics.ts`, `describe.ts`, `skill-files.ts`,
  `skill-library.ts`), the surface catalog `packages/contracts/src/surface.ts`, the skills in `skills/`.
- Tests: `packages/contracts/src/guide/guide.test.ts`; `apps/mcp/src/server.test.ts` ("guide tools", "skills through
  the guide tool"); `apps/cli/src/commands.test.ts` ("aieng guide and describe").

## Reach it

| Transport | How |
| --- | --- |
| MCP | `aieng_guide [topic]`, `aieng_describe <operation>` |
| CLI | `aieng guide [topic, skill or skill/references/name]`, `aieng describe <operation>`, `aieng operations` (no variable needed) |
| HTTP | `GET /v1/guide[/<topic>]`, `GET /v1/operations[/<operation>]` (no session needed) |

Proven by: `node apps/cli/dist/main.js guide` after `pnpm build` (and
`pnpm --filter @aiengineer/service-contracts exec vitest run src/guide`).

<a id="skills"></a>
## Rules for guide and skill pages

- The guide is the one place for operational how-to. `skills/ai-engineer` only routes to it; `content-authoring` and
  `ai-engineer-knowledge-charter` say how to do the work well.
- The guide serves every `SKILL.md` and every file under a skill's `references/` as a topic. A new skill page needs its
  import line in `guide/skill-files.ts`; the build inlines the Markdown, and a test fails when the list and the folder
  differ. `SOURCES.md` is provenance and is not served.
- A skill names a tool and says when to use it. It never restates arguments (those come from `aieng_describe`) and
  never names a database schema, table or column. What exists today is said once, in its Availability section.
- In guide and skill pages a code span starts with a tool or operation name, starts with `aieng`, or is a literal, so
  the test that every named tool, operation and command exists stays mechanical.
- A new operation needs a guide topic (`guide/operation-topics.ts`); a new tool or command needs an entry in
  `surface.ts`.

## Gotchas

- The Markdown is bundled at build time (`tsup --loader .md=text`): run `pnpm build` after editing a skill page before
  the CLI or a server shows it.
- Pages have size budgets (`guideTokenBudgets`); the tests fail past them.
