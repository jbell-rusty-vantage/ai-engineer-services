import { knowledgeContentKinds, knowledgeLenses, ProductError } from "@aiengineer/service-contracts";
import { z } from "zod";
import { defineTool } from "./tool-definition.js";

const id = z.guid();

export const searchKnowledge = defineTool({
  name: "search_knowledge",
  input: z.object({
    query: z.string().min(1).describe("2 to 5 specific keywords, not a question"),
    lenses: z.array(z.enum(knowledgeLenses)).optional().describe("Default both; evidence = judged claims only"),
    tiers: z
      .array(z.number().int().min(0).max(4))
      .optional()
      .describe("0 verified assertions, 2 primary corpus, 3 third-party corpus, 4 live web"),
    spaces: z.array(z.string()).optional().describe("Search space slugs"),
    kinds: z.array(z.enum(knowledgeContentKinds)).optional(),
    as_of: z.string().optional().describe("ISO time: facts valid then"),
    limit: z.number().int().min(1).max(50).optional().describe("Default 10"),
    collapse: z.boolean().optional().describe("false returns every item of one target"),
  }),
  run: (context, input) => context.port.read("search_knowledge", { payload: input }),
});

function required(value: string | undefined, what: string): string {
  if (!value) throw new ProductError("VALIDATION", `id is required to inspect a ${what}`);
  return value;
}

export const inspectKnowledge = defineTool({
  name: "inspect_knowledge",
  input: z.object({
    what: z.enum(["claim", "entity", "source", "due"]),
    id: id.optional().describe("The claim id, entity id or source entity id (from a search hit)"),
    library: z.string().optional().describe("entity: a library slug, for its dossier instead of a card"),
    name: z.string().optional().describe("source: the source's name instead of its id"),
    as_of: z.string().optional().describe("due: evaluate at this ISO time (default now)"),
    since: z.string().optional().describe("due: also list what was learned after this ISO time"),
    release_id: id.optional().describe("due: also list our modules affected by this software release"),
  }),
  run: (context, input) => {
    const read = (operation: string, payload: Record<string, unknown>) => context.port.read(operation, { payload });
    switch (input.what) {
      case "claim":
        return read("get_claim", { claim_id: required(input.id, "claim") });
      case "entity":
        return read(
          "get_entity",
          input.library ? { library: input.library } : { entity_id: required(input.id, "entity") },
        );
      case "source":
        return read(
          "get_source",
          input.name ? { name: input.name } : { source_entity_id: required(input.id, "source") },
        );
      case "due":
        return read("list_due", {
          ...(input.as_of ? { as_of: input.as_of } : {}),
          ...(input.since ? { since: input.since } : {}),
          ...(input.release_id ? { release_id: input.release_id } : {}),
        });
    }
  },
});
