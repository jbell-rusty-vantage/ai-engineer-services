import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { knowledgeOperations } from "../knowledge.js";
import { operationCatalog, publicOperations } from "../operations.js";
import { findSurfaceCommand, guideTopics, surfaceCommands, surfaceJobs, surfaceTools } from "../surface.js";
import { describeReference, type OperationDescription, type ToolDescription } from "./describe.js";
import { operationNotes } from "./operation-notes.js";
import { operationTopics, topicForOperation } from "./operation-topics.js";
import { topicMethods } from "./pages.js";
import { scanGuideReferences } from "./references.js";
import { estimateTokens, guideIndexTopic, guideTokenBudgets, guideTopicNames, renderGuide } from "./render.js";
import { skillFiles } from "./skill-files.js";
import { guideSkills, methodSkills, routerSkillName, skillFrontmatter, skillTopics } from "./skill-library.js";

const pages = [guideIndexTopic, ...guideTopics].map((topic) => renderGuide(topic));
const toolNames = new Set(surfaceTools.map((tool) => tool.name));
const publicNames = new Set(publicOperations().map((operation) => operation.name));

/** An `aieng` command line named in a page: the command exists, and so does the operation or topic it names. */
function expectCommandExists(page: string, words: readonly string[]): void {
  const command = findSurfaceCommand(words);
  expect(command, `${page} names aieng ${words.join(" ")}`).toBeDefined();
  const argument = words[command?.path.length ?? 0];
  if (!argument) return;
  const verb = command?.path.join(" ");
  if (verb === "command" || verb === "read") expect(operationCatalog.get(argument)?.kind, argument).toBe(verb);
  if (verb === "guide")
    expect([guideIndexTopic, ...guideTopicNames], `${page} names topic ${argument}`).toContain(argument);
}

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
    expect(renderGuide().topics).toEqual([...guideTopics, ...skillTopics]);
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
    expect(scanGuideReferences("`aieng guide content-authoring/references/lesson-craft`").commands).toEqual([
      ["guide", "content-authoring/references/lesson-craft"],
    ]);
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
      for (const words of scanGuideReferences(page.text).commands) expectCommandExists(page.topic, words);
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
    for (const words of references.commands) expectCommandExists("the skill", words);
  });
});

describe("skills in the guide", () => {
  const skillsDirectory = new URL("../../../../skills/", import.meta.url);

  /** Every page the guide must serve: each `SKILL.md` and each file under a skill's `references/`, read from disk. */
  function servedFilesOnDisk(): Record<string, string> {
    const files: Record<string, string> = {};
    for (const skill of readdirSync(skillsDirectory, { withFileTypes: true })) {
      if (!skill.isDirectory()) continue;
      const read = (path: string) => readFileSync(new URL(`${skill.name}/${path}`, skillsDirectory), "utf8");
      files[`${skill.name}/SKILL.md`] = read("SKILL.md");
      const references = new URL(`${skill.name}/references/`, skillsDirectory);
      if (!existsSync(references)) continue;
      for (const reference of readdirSync(references, { recursive: true, encoding: "utf8" })) {
        const path = `references/${reference.replace(/\\/g, "/")}`;
        if (path.endsWith(".md")) files[`${skill.name}/${path}`] = read(path);
      }
    }
    return files;
  }

  const onDisk = servedFilesOnDisk();
  const unix = (text: string) => text.replace(/\r\n/g, "\n");

  it("bundles every skill page of the skills folder, and nothing else", () => {
    expect(Object.keys(skillFiles).sort()).toEqual(Object.keys(onDisk).sort());
    for (const [path, text] of Object.entries(onDisk)) expect(unix(skillFiles[path] ?? ""), path).toBe(unix(text));
  });

  it("serves every skill by its name and every reference by its path, as the file's own Markdown", () => {
    for (const [path, text] of Object.entries(onDisk)) {
      const topic = path.replace(/\.md$/, "").replace(/\/SKILL$/, "");
      expect(skillTopics, topic).toContain(topic);
      const page = renderGuide(topic);
      expect(page.topic).toBe(topic);
      expect(page.text, topic).toBe(unix(text).trimEnd());
      expect(page.topics).toEqual(guideTopicNames);
      expect(renderGuide(path).text, `${path} with its file name`).toBe(page.text);
    }
    expect(renderGuide("content-authoring/references/lesson-craft").title).toMatch(/^Lesson craft/);
    expect(renderGuide(" Content-Authoring/SKILL.md ").topic).toBe("content-authoring");
    expect(() => renderGuide("content-authoring/SOURCES")).toThrowError(/NOT_FOUND/);
    expect(() => renderGuide("content-authoring/references/cooking")).toThrowError(/NOT_FOUND/);
  });

  it("gives every skill a name that is its folder and a one-line description", () => {
    expect(guideSkills.map((skill) => skill.name)).toEqual(
      [...new Set(Object.keys(onDisk).map((path) => path.slice(0, path.indexOf("/"))))].sort(),
    );
    for (const skill of guideSkills) {
      expect(skillFrontmatter(skill.page.text).name, skill.name).toBe(skill.name);
      expect(skill.description.length, skill.name).toBeGreaterThanOrEqual(80);
      expect(skill.description).not.toContain("\n");
      expect(skill.name).toMatch(/^[a-z][a-z0-9-]*$/);
      for (const reference of skill.references) expect(reference.topic).toMatch(/^[a-z0-9/-]+$/);
    }
    expect(guideSkills.map((skill) => skill.name)).toContain(routerSkillName);
  });

  it("lists the method skills on the start page with their descriptions and their references", () => {
    const index = renderGuide().text;
    expect(methodSkills.map((skill) => skill.name)).toEqual(["ai-engineer-knowledge-charter", "content-authoring"]);
    for (const skill of methodSkills) {
      expect(index).toContain(`- ${skill.name}: ${skill.description}`);
      for (const reference of skill.references) expect(index, reference.topic).toContain(reference.topic);
    }
    expect(index).not.toContain(`- ${routerSkillName}:`);
  });

  it("keeps a skill page within its size budget", () => {
    for (const topic of skillTopics) {
      expect(estimateTokens(renderGuide(topic).text), topic).toBeLessThanOrEqual(guideTokenBudgets.skill);
    }
  });

  it("links each overlapping topic to the skill that holds its method", () => {
    expect(Object.keys(topicMethods).sort()).toEqual(["authoring", "knowledge", "research"]);
    for (const [topic, method] of Object.entries(topicMethods)) {
      expect(skillTopics, topic).toContain(method.skill);
      expect(renderGuide(topic).text, topic).toContain(`\`aieng_guide {topic: "${method.skill}"}\``);
    }
  });

  it("names, in every skill page, only tools, operations and commands that exist", () => {
    for (const topic of skillTopics) {
      const references = scanGuideReferences(renderGuide(topic).text);
      for (const name of references.names) {
        expect(toolNames.has(name) || publicNames.has(name), `${topic} names ${name}`).toBe(true);
      }
      for (const words of references.commands) expectCommandExists(topic, words);
    }
  });

  it("names every MCP tool in the content-authoring availability section", () => {
    const availability = renderGuide("content-authoring").text.split("## Availability")[1] ?? "";
    const named = new Set(scanGuideReferences(availability).names);
    for (const tool of ["draft_work", "inspect_authoring", "request_review", "read_lesson", "cite_evidence"]) {
      expect(named, tool).toContain(tool);
    }
  });

  it("names no database schema, table or column in a skill page", () => {
    const schemas =
      /\b(?:api|access|authoring|catalog|content|conversation|corpus|curriculum|dataset|evaluation|evidence|inquiry|knowledge|learning|library|orchestration|product|retrieval|util)\.[a-z_]{3,}\b/g;
    for (const topic of skillTopics) {
      expect(renderGuide(topic).text.match(schemas) ?? [], topic).toEqual([]);
    }
  });
});

describe("authoring structure", () => {
  const input = (describeReference("create_work") as OperationDescription).input as {
    properties: { revision: { properties: Record<string, { items?: { properties?: Record<string, unknown> } }> } };
  };
  const fields = input.properties.revision.properties;

  it("describes the shape of every structure field of a revision", () => {
    const expected: Record<string, string[]> = {
      bindings: ["local_key", "relation", "target", "role", "block_key", "usage"],
      parts: ["occurrence_key", "child_revision_id", "ordinal", "role"],
      outcomes: ["outcome_key", "statement", "bloom_level", "evidence_rule", "alignments"],
      requirements: ["requirement_key", "kind", "outcome_key", "occurrence_key", "rationale", "options"],
      prerequisites: ["required_revision_id", "strength", "rationale"],
      runtime: ["local_key", "kind", "ecosystem", "name", "version_spec", "resolved_version", "phase"],
      assertions: ["block_key", "kind", "statement", "support_status", "uses_claim_id"],
    };
    for (const [field, keys] of Object.entries(expected)) {
      const described = Object.keys(fields[field]?.items?.properties ?? {});
      for (const key of keys) expect(described, `${field}.${key}`).toContain(key);
    }
  });

  it("accepts the structure the database accepts and refuses values it would refuse", () => {
    const schema = operationCatalog.get("create_work")?.payload;
    const example = operationNotes.create_work?.example as { revision: Record<string, unknown> };
    const withRevision = (change: Record<string, unknown>) => ({
      ...example,
      revision: { ...example.revision, ...change },
    });
    expect(schema?.safeParse(example).success).toBe(true);
    expect(schema?.safeParse(withRevision({ extra_field: true })).success, "unknown fields pass through").toBe(true);
    const refused: Record<string, unknown>[] = [
      { parts: [{ occurrence_key: "p1", child_revision_id: "c1", ordinal: 0 }] },
      { requirements: [{ requirement_key: "r1", kind: "optional", rationale: "x" }] },
      { prerequisites: [{ required_revision_id: "0193e3c1-6f5a-7c3e-9a1b-2c3d4e5f6a7b", strength: "strong" }] },
      { bindings: [{ local_key: "c", relation: "proves", target: { kind: "claim", id: "x" } }] },
      { assertions: [{ kind: "rumour", statement: "x", support_status: "supported" }] },
    ];
    for (const change of refused) {
      expect(schema?.safeParse(withRevision(change)).success, JSON.stringify(change)).toBe(false);
    }
  });

  it("keeps the review decisions people make out of every tool", () => {
    const peopleOnly = [
      "review_revision",
      "freeze_release",
      "open_distribution",
      "offer_release",
      "accept_research",
      "decide_delivery",
      "decide_dataset_change",
    ];
    for (const tool of surfaceTools) {
      for (const operation of peopleOnly)
        expect(tool.operations, `${tool.name} calls ${operation}`).not.toContain(operation);
    }
  });
});
