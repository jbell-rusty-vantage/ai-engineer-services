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
    what: z.enum(["claim", "entity", "fact_evidence", "entity_changes", "summary_evidence", "source", "due"]),
    id: id
      .optional()
      .describe(
        "The claim id, entity id, summary id or source entity id (entity for fact_evidence and entity_changes)",
      ),
    library: z.string().optional().describe("entity: a library slug, for its dossier instead of a card"),
    stream_kind: z.string().optional().describe("fact_evidence: the fact kind, as stream_kind on the entity card"),
    scope_key: z.string().optional().describe("fact_evidence: one scope of that kind, as scope_key on the card"),
    after_seq: z.number().int().min(0).optional().describe("entity_changes: changes after this knowledge sequence"),
    through_seq: z.number().int().min(1).optional().describe("entity_changes: up to this sequence (default: head)"),
    name: z.string().optional().describe("source: the source's name instead of its id"),
    as_of: z.string().optional().describe("due: evaluate at this ISO time (default now)"),
    since: z.string().optional().describe("due: also list what was learned after this ISO time"),
    release_id: id.optional().describe("due: also list our modules affected by this software release"),
    limit: z.number().int().min(1).max(100).optional().describe("fact_evidence, entity_changes, summary_evidence, due"),
  }),
  run: (context, input) => {
    const read = (operation: string, payload: Record<string, unknown>) => context.port.read(operation, { payload });
    const limit = input.limit ? { limit: input.limit } : {};
    switch (input.what) {
      case "claim":
        return read("get_claim", { claim_id: required(input.id, "claim") });
      case "entity":
        return read(
          "get_entity",
          input.library ? { library: input.library } : { entity_id: required(input.id, "entity") },
        );
      case "fact_evidence":
        if (!input.stream_kind) throw new ProductError("VALIDATION", "stream_kind is required for fact_evidence");
        return read("get_fact_evidence", {
          entity_id: required(input.id, "fact's entity"),
          stream_kind: input.stream_kind,
          ...(input.scope_key ? { scope_key: input.scope_key } : {}),
          ...limit,
        });
      case "entity_changes":
        return read("list_entity_changes", {
          entity_id: required(input.id, "changed entity"),
          ...(input.after_seq === undefined ? {} : { after_seq: input.after_seq }),
          ...(input.through_seq === undefined ? {} : { through_seq: input.through_seq }),
          ...limit,
        });
      case "summary_evidence":
        return read("get_summary_evidence", { summary_id: required(input.id, "summary"), ...limit });
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
          ...limit,
        });
    }
  },
});
