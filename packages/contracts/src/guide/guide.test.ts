import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { knowledgeOperations } from "../knowledge.js";
import { operationCatalog, publicOperations } from "../operations.js";
import { findSurfaceCommand, guideTopics, surfaceCommands, surfaceJobs, surfaceTools } from "../surface.js";
import { describeReference, type OperationDescription, type ToolDescription } from "./describe.js";
import { operationNotes } from "./operation-notes.js";
import { operationTopics, topicForOperation } from "./operation-topics.js";
import { scanGuideReferences } from "./references.js";
import { estimateTokens, guideIndexTopic, guideTokenBudgets, renderGuide } from "./render.js";

const pages = [guideIndexTopic, ...guideTopics].map((topic) => renderGuide(topic));
const toolNames = new Set(surfaceTools.map((tool) => tool.name));
const publicNames = new Set(publicOperations().map((operation) => operation.name));

describe("surface catalog", () => {
  it("gives every job existing tools and an existing operation", () => {
    for (const job of surfaceJobs) {
      for (const tool of job.tools) expect(toolNames, `${job.id} names ${tool}`).toContain(tool);
      if ("operation" in job) expect(publicNames).toContain(job.operation);
    }
  });

  it("puts every tool in a job, except the guide tools that serve all of them", () => {
    const inJobs = new Set<string>(surfaceJobs.flatMap((job) => [...job.tools]));
    const outside = surfaceTools.filter((tool) => !inJobs.has(tool.name)).map((tool) => tool.name);
    expect(outside).toEqual(["aieng_guide", "aieng_describe"]);
  });

  it("names only public operations as the ones a tool calls", () => {
    for (const tool of surfaceTools) {
      for (const operation of tool.operations)
        expect(publicNames, `${tool.name} calls ${operation}`).toContain(operation);
    }
  });

  it("keeps tool descriptions to one short line", () => {
    for (const tool of surfaceTools) {
      expect(tool.summary.length, tool.name).toBeLessThanOrEqual(160);
      expect(tool.summary).not.toContain("\n");
    }
  });

  it("gives every command a unique path", () => {
    const paths = surfaceCommands.map((command) => command.path.join(" "));
    expect(new Set(paths).size).toBe(paths.length);
    expect(findSurfaceCommand(["site", "publish", "./dist"])?.path).toEqual(["site", "publish"]);
    expect(findSurfaceCommand(["dance"])).toBeUndefined();
  });
});

describe("guide topics", () => {
  it("places every public operation in exactly one topic", () => {
    const placed = Object.values(operationTopics).flat();
    expect(new Set(placed).size).toBe(placed.length);
    expect([...placed].sort()).toEqual([...publicNames].sort());
    expect(topicForOperation("get_claim")).toBe("knowledge");
  });

  it("stays within its size budgets", () => {
    for (const page of pages) {
      const budget = page.topic === guideIndexTopic ? guideTokenBudgets.index : guideTokenBudgets.topic;
      expect(estimateTokens(page.text), page.topic).toBeLessThanOrEqual(budget);
    }
  });

  it("names every job and every topic on the start page", () => {
    const index = renderGuide().text;
    for (const job of surfaceJobs) expect(index).toContain(job.label);
    for (const topic of guideTopics) expect(index).toContain(topic);
    expect(renderGuide("index").text).toBe(index);
  });

  it("lists each topic's operations from the catalog", () => {
    for (const topic of guideTopics) {
      const text = renderGuide(topic).text;
      for (const operation of operationTopics[topic]) expect(text, `${topic} lists ${operation}`).toContain(operation);
    }
  });

  it("explains how to create and release a course, module, lesson, activity and artifact", () => {
    const text = renderGuide("authoring").text;
    for (const word of ["course", "module", "lesson", "activity", "artifact", "parts", "claim"]) {
      expect(text).toContain(word);
    }
    const { names } = scanGuideReferences(text);
    for (const operation of [
      "create_work",
      "revise_work",
      "preview_exposure",
      "review_revision",
      "freeze_release",
      "open_distribution",
      "offer_release",
      "add_support",
      "cite_evidence",
    ]) {
      expect(names, operation).toContain(operation);
    }
  });

  it("refuses an unknown topic and names the real ones", () => {
    expect(() => renderGuide("cooking")).toThrowError(/NOT_FOUND.*knowledge/);
  });
});

describe("guide references", () => {
  it("reads tools, operations and commands out of code spans", () => {
    const text =
      "Call `get_claim {claim_id}` or `enroll {distribution_id}`, then `aieng knowledge claim <claim-id>` and " +
      '`aieng command create_work --workspace <id>`. `"release_review"`, `domains/evidence.md` and `POST /v1/assets` are literals.';
    expect(scanGuideReferences(text)).toEqual({
      names: ["get_claim", "enroll"],
      commands: [
        ["knowledge", "claim"],
        ["command", "create_work"],
      ],
    });
  });

  it("names only tools and operations that exist", () => {
    for (const page of pages) {
      for (const name of scanGuideReferences(page.text).names) {
        expect(toolNames.has(name) || publicNames.has(name), `${page.topic} names ${name}`).toBe(true);
      }
    }
  });

  it("names only CLI commands that exist", () => {
    for (const page of pages) {
      for (const words of scanGuideReferences(page.text).commands) {
        const command = findSurfaceCommand(words);
        expect(command, `${page.topic} names aieng ${words.join(" ")}`).toBeDefined();
        const argument = words[command?.path.length ?? 0];
        if (!argument) continue;
        const verb = command?.path.join(" ");
        if (verb === "command" || verb === "read") expect(operationCatalog.get(argument)?.kind).toBe(verb);
        if (verb === "guide") expect(guideTopics as readonly string[]).toContain(argument);
      }
    }
  });
});

describe("describe", () => {
  it("gives an operation's input schema, output and a valid example", () => {
    const description = describeReference("create_work") as OperationDescription;
    expect(description).toMatchObject({
      operation: "create_work",
      kind: "command",
      topic: "authoring",
      request: { method: "POST", path: "/v1/commands/create_work" },
      output: "{ workId, revisionId }",
      tools: ["annotate_lesson_block", "draft_work"],
      schema_pages: ["ops/create_work.md"],
    });
    const input = description.input as { properties: { kind: { enum: string[] } } };
    expect(input.properties.kind.enum).toEqual(expect.arrayContaining(["course", "module", "lesson", "activity"]));
    expect(description.example.cli).toContain("aieng command create_work --workspace <workspace-id> --payload");
  });

  it("describes the knowledge reads without a workspace", () => {
    for (const name of knowledgeOperations) {
      const description = describeReference(name) as OperationDescription;
      expect(description.scope, name).toBe("read");
      expect(description.topic, name).toBe("knowledge");
      expect(description.kind).toBe("read");
      expect(description.output, name).toBeTruthy();
      expect(description.example.payload, name).not.toBeNull();
      expect(description.example.cli).not.toContain("--workspace");
      expect(description.schema_pages.length).toBeGreaterThan(0);
    }
  });

  it("says when only the database validates a payload", () => {
    expect((describeReference("create_thread") as OperationDescription).input).toBeNull();
  });

  it("names the operations a tool calls", () => {
    expect(describeReference("inspect_knowledge") as ToolDescription).toMatchObject({
      tool: "inspect_knowledge",
      topics: ["knowledge"],
      operations: [
        "get_claim",
        "get_entity",
        "get_fact_evidence",
        "list_entity_changes",
        "get_summary_evidence",
        "get_source",
        "list_due",
      ],
    });
    for (const operation of knowledgeOperations) {
      const tools = (describeReference(operation) as OperationDescription).tools;
      expect(tools, operation).toEqual([operation === "search_knowledge" ? "search_knowledge" : "inspect_knowledge"]);
    }
  });

  it("refuses composite and unknown references", () => {
    expect(() => describeReference("register_asset")).toThrowError(/UNKNOWN_OPERATION/);
    expect(() => describeReference("drop_everything")).toThrowError(/UNKNOWN_OPERATION/);
  });

  it("only notes catalogued operations, with examples that pass the edge schema", () => {
    for (const [name, note] of Object.entries(operationNotes)) {
      const definition = operationCatalog.get(name);
      expect(definition, name).toBeDefined();
      if (note.example) expect(definition?.payload.safeParse(note.example).success, `${name} example`).toBe(true);
    }
  });
});

describe("the agent skill", () => {
  const skill = readFileSync(new URL("../../../../skills/ai-engineer/SKILL.md", import.meta.url), "utf8");

  it("is a short router with a name and a description that sends the agent to the guide first", () => {
    const [, frontmatter = "", body = ""] = skill.split(/^---$/m);
    expect(frontmatter).toMatch(/^name: ai-engineer$/m);
    expect(frontmatter).toMatch(/^description: .{80,}$/m);
    expect(skill.trimEnd().split("\n").length).toBeLessThanOrEqual(80);
    expect(body.indexOf("aieng_guide")).toBeGreaterThan(0);
    expect(body.indexOf("aieng_guide")).toBeLessThan(body.indexOf("## Jobs"));
  });

  it("covers every job, topic and tool, and names only tools, operations and commands that exist", () => {
    for (const topic of guideTopics) expect(skill).toContain(topic);
    for (const tool of surfaceTools) expect(skill, tool.name).toContain(`\`${tool.name}`);
    const references = scanGuideReferences(skill);
    for (const name of references.names) {
      expect(toolNames.has(name) || publicNames.has(name), `the skill names ${name}`).toBe(true);
    }
    for (const words of references.commands) {
      const command = findSurfaceCommand(words);
      expect(command, `the skill names aieng ${words.join(" ")}`).toBeDefined();
      const argument = words[command?.path.length ?? 0];
      const verb = command?.path.join(" ");
      if (argument && (verb === "command" || verb === "read")) expect(operationCatalog.get(argument)?.kind).toBe(verb);
    }
  });
});
