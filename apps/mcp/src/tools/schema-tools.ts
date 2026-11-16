import {
  formatSchemaPage,
  ProductError,
  type SchemaPort,
  schemaEntryKinds,
  schemaSearchLimits,
} from "@aiengineer/service-contracts";
import { z } from "zod";
import { defineTool, type ToolContext } from "./tool-definition.js";

function schemaOf(context: ToolContext): SchemaPort {
  if (!context.schema) throw new ProductError("NOT_AVAILABLE", "schema navigation is not configured on this server");
  return context.schema;
}

export const schemaSearch = defineTool({
  name: "schema_search",
  input: z.object({
    query: z.string().min(1).describe("A name, column, alias or term, such as verified claims"),
    kind: z.enum(schemaEntryKinds).optional(),
    limit: z.number().int().min(1).max(schemaSearchLimits.maximum).optional(),
  }),
  run: (context, input) => schemaOf(context).searchSchema(input.query, { limit: input.limit, kind: input.kind }),
});

export const schemaGet = defineTool({
  name: "schema_get",
  input: z.object({
    page: z.string().optional().describe("A path from schema_search, such as relations/api/verified_claims.md"),
  }),
  run: async (context, input) => formatSchemaPage(await schemaOf(context).getSchemaPage(input.page)),
});
