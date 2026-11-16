import { describeReference, guideIndexTopic, guideTopics, renderGuide } from "@aiengineer/service-contracts";
import { z } from "zod";
import { defineTool } from "./tool-definition.js";

export const aiengGuide = defineTool({
  name: "aieng_guide",
  input: z.object({
    topic: z
      .enum([guideIndexTopic, ...guideTopics])
      .optional()
      .describe("Omit for the start page (jobs and the tool for each)"),
  }),
  run: async (_context, input) => renderGuide(input.topic).text,
});

export const aiengDescribe = defineTool({
  name: "aieng_describe",
  input: z.object({ ref: z.string().min(1).describe("An operation name from the guide, or a tool name") }),
  run: async (_context, input) => describeReference(input.ref),
});
