import {
  type AssetUploadResult,
  type CommandInput,
  estimateTokens,
  guideIndexTopic,
  guideTokenBudgets,
  guideTopicNames,
  guideTopics,
  type JsonObject,
  operationCatalog,
  type ProductPort,
  publicOperations,
  type ReadInput,
  renderGuide,
  type SchemaPort,
  scanGuideReferences,
  skillTopics,
  surfaceTools,
} from "@aiengineer/service-contracts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { aiEngineerTools, createAiEngineerMcpServer } from "./server.js";
import { draftWork, inspectAuthoring, publishBuiltSite, requestReview } from "./tools/authoring-tools.js";
import { aiengDescribe, aiengGuide } from "./tools/guide-tools.js";
import { inspectKnowledge, searchKnowledge } from "./tools/knowledge-tools.js";
import { citeEvidence, inspectResearch, updateDataset } from "./tools/research-tools.js";
import { schemaGet, schemaSearch } from "./tools/schema-tools.js";
import type { ToolContext } from "./tools/tool-definition.js";

class RecordingPort implements ProductPort {
  readonly commands: { operation: string; input: CommandInput }[] = [];
  readonly reads: { operation: string; input: ReadInput }[] = [];
  async command(operation: string, input: CommandInput): Promise<JsonObject> {
    this.commands.push({ operation, input });
    if (operation === "ensure_personal_workspace") return { workspaceId: "personal" };
    if (operation === "register_file_set") return { fileSetId: "fs1", treeSha256: "t" };
    if (operation === "record_deployment")
      return { deploymentId: "d1", url: "https://d1.preview.example", status: "pending" };
    return { ok: true };
  }
  async read(operation: string, input: ReadInput): Promise<unknown> {
    this.reads.push({ operation, input });
    return [];
  }
  async uploadAsset(): Promise<AssetUploadResult> {
    return { artifactId: `a${this.commands.length}`, sha256: "s", sizeBytes: 1 };
  }
}

const head = { migration_head: "20261115120100", contract_version: "0.6.0", fingerprint: "sha256:fixture" };

class RecordingSchema implements SchemaPort {
  readonly asked: unknown[] = [];
  async searchSchema(query: string, options?: { limit?: number; kind?: string }) {
    this.asked.push({ query, ...options });
    return { head, query, total: 0, results: [], next: "Four reads at most" };
  }
  async getSchemaPage(page?: string) {
    this.asked.push({ page });
    return { head, page: page ?? "START_HERE.md", bytes: 12, truncated: false, text: "# Start here" };
  }
}

const id = "0193e3c1-6f5a-7c3e-9a1b-2c3d4e5f6a7b";

/** Lists and calls tools through the MCP protocol itself, as an agent's client does. */
async function connect(context: ToolContext): Promise<Client> {
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await createAiEngineerMcpServer(context).connect(serverSide);
  const client = new Client({ name: "mcp-test", version: "0.1.0" });
  await client.connect(clientSide);
  return client;
}

async function callText(client: Client, name: string, args: Record<string, unknown>) {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: { text: string }[];
  };
  return { isError: result.isError === true, text: result.content[0]?.text ?? "" };
}

describe("MCP tools", () => {
  it("exposes a small, uniquely named, task-shaped set: exactly the surface catalog", () => {
    const names = aiEngineerTools.map((tool) => tool.name);
    expect(names).toEqual(surfaceTools.map((tool) => tool.name));
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBeLessThanOrEqual(23);
    for (const name of names) expect(name).toMatch(/^[a-z]+(_[a-z]+)+$/);
  });

  it("refuses local folders on the remote server", async () => {
    await expect(
      publishBuiltSite.run(
        { port: new RecordingPort(), localFiles: false },
        { workspace_id: "0193e3c1-6f5a-7c3e-9a1b-2c3d4e5f6a7b", directory: "C:/site" },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("maps research tools onto catalog operations", async () => {
    const port = new RecordingPort();
    const context = { port, localFiles: false };
    const ws = "0193e3c1-6f5a-7c3e-9a1b-2c3d4e5f6a7b";
    const other = "0193e3c1-6f5a-7c3e-9a1b-2c3d4e5f6a7c";
    await updateDataset.run(context, {
      workspace_id: ws,
      dataset_work_id: other,
      mode: "proposal",
      base_revision_no: 1,
      dedupe_key: "r1",
      cells: [],
    });
    await updateDataset.run(context, { workspace_id: ws, dataset_work_id: other, mode: "draft", cells: [] });
    await citeEvidence.run(context, {
      workspace_id: ws,
      statement_id: other,
      role: "contradicts",
      source_revision_id: other,
      quotes: ["a", "b"],
    });
    expect(port.commands.map((call) => call.operation)).toEqual([
      "propose_dataset_change",
      "edit_dataset",
      "add_support",
    ]);
    expect(port.commands[2]?.input.payload).toMatchObject({
      subject: { assertion_id: other },
      target: { kind: "source_revision", id: other },
      selector: { type: "aieng.text-quotes.v1", quotes: ["a", "b"] },
    });
    await expect(inspectResearch.run(context, { workspace_id: ws, what: "statement", id: other })).resolves.toEqual([]);
  });

  it("publishes a site from base64 files through the port", async () => {
    const port = new RecordingPort();
    const result = await publishBuiltSite.run(
      { port, localFiles: false },
      {
        workspace_id: "0193e3c1-6f5a-7c3e-9a1b-2c3d4e5f6a7b",
        files: [
          { path: "index.html", content_base64: Buffer.from("<html></html>").toString("base64") },
          { path: "app.js", content_base64: Buffer.from("1").toString("base64") },
        ],
      },
    );
    expect(result).toMatchObject({ fileSetId: "fs1", deploymentId: "d1", files: 2 });
    expect(port.commands.map((call) => call.operation)).toEqual(["register_file_set", "record_deployment"]);
  });
});

describe("knowledge tools", () => {
  it("search_knowledge passes its filters to the search_knowledge operation", async () => {
    const port = new RecordingPort();
    await searchKnowledge.run({ port, localFiles: false }, { query: "retries", lenses: ["evidence"], limit: 5 });
    expect(port.reads).toEqual([
      { operation: "search_knowledge", input: { payload: { query: "retries", lenses: ["evidence"], limit: 5 } } },
    ]);
    await expect(
      searchKnowledge.run({ port, localFiles: false }, { query: "retries", lenses: ["private"] }),
    ).rejects.toBeDefined();
  });

  it("inspect_knowledge reads a claim, an entity, a source or what is due", async () => {
    const port = new RecordingPort();
    const context = { port, localFiles: false };
    await inspectKnowledge.run(context, { what: "claim", id });
    await inspectKnowledge.run(context, { what: "entity", id });
    await inspectKnowledge.run(context, { what: "entity", library: "langgraph" });
    await inspectKnowledge.run(context, { what: "source", name: "A. Author" });
    await inspectKnowledge.run(context, { what: "due", since: "2026-11-01T00:00:00Z" });
    expect(port.reads.map((read) => [read.operation, read.input.payload])).toEqual([
      ["get_claim", { claim_id: id }],
      ["get_entity", { entity_id: id }],
      ["get_entity", { library: "langgraph" }],
      ["get_source", { name: "A. Author" }],
      ["list_due", { since: "2026-11-01T00:00:00Z" }],
    ]);
    await expect(inspectKnowledge.run(context, { what: "claim" })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("inspect_knowledge reads the evidence of a fact or a summary and an entity's changes", async () => {
    const port = new RecordingPort();
    const context = { port, localFiles: false };
    await inspectKnowledge.run(context, { what: "fact_evidence", id, stream_kind: "offering_price", limit: 3 });
    await inspectKnowledge.run(context, { what: "entity_changes", id, after_seq: 0 });
    await inspectKnowledge.run(context, { what: "entity_changes", id, after_seq: 40, through_seq: 42 });
    await inspectKnowledge.run(context, { what: "summary_evidence", id });
    expect(port.reads.map((read) => [read.operation, read.input.payload])).toEqual([
      ["get_fact_evidence", { entity_id: id, stream_kind: "offering_price", limit: 3 }],
      ["list_entity_changes", { entity_id: id, after_seq: 0 }],
      ["list_entity_changes", { entity_id: id, after_seq: 40, through_seq: 42 }],
      ["get_summary_evidence", { summary_id: id }],
    ]);
    await expect(inspectKnowledge.run(context, { what: "fact_evidence", id })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(inspectKnowledge.run(context, { what: "entity_changes" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });
});

describe("schema tools", () => {
  it("search and get go to the schema port; a page comes back as text under the workspace head", async () => {
    const schema = new RecordingSchema();
    const context = { port: new RecordingPort(), schema, localFiles: false };
    await expect(schemaSearch.run(context, { query: "verified claims", kind: "view" })).resolves.toMatchObject({
      head,
    });
    const page = await schemaGet.run(context, {});
    expect(page).toBe(
      "schema workspace: migration head 20261115120100, contract 0.6.0, fingerprint sha256:fixture (page START_HERE.md, 12 bytes)\n\n# Start here",
    );
    expect(schema.asked).toEqual([{ query: "verified claims", limit: undefined, kind: "view" }, { page: undefined }]);
  });

  it("answer NOT_AVAILABLE on a host without a schema workspace", async () => {
    await expect(
      schemaSearch.run({ port: new RecordingPort(), localFiles: false }, { query: "x" }),
    ).rejects.toMatchObject({
      code: "NOT_AVAILABLE",
    });
  });
});

describe("guide tools", () => {
  const context = { port: new RecordingPort(), localFiles: false };

  it("aieng_guide returns the start page, or a topic, as text", async () => {
    await expect(aiengGuide.run(context, {})).resolves.toBe(renderGuide().text);
    await expect(aiengGuide.run(context, { topic: "authoring" })).resolves.toBe(renderGuide("authoring").text);
    await expect(aiengGuide.run(context, { topic: "cooking" })).rejects.toBeDefined();
  });

  it("aieng_describe returns one operation's shapes", async () => {
    await expect(aiengDescribe.run(context, { ref: "search_knowledge" })).resolves.toMatchObject({
      operation: "search_knowledge",
      tools: ["search_knowledge"],
    });
    await expect(aiengDescribe.run(context, { ref: "nope" })).rejects.toMatchObject({ code: "UNKNOWN_OPERATION" });
  });

  it("names, in every guide page, only tools this server registers and operations the catalog has", () => {
    const tools = new Set(aiEngineerTools.map((tool) => tool.name));
    const operations = new Set(publicOperations().map((operation) => operation.name));
    for (const topic of [guideIndexTopic, ...guideTopics]) {
      for (const name of scanGuideReferences(renderGuide(topic).text).names) {
        expect(tools.has(name) || operations.has(name), `${topic} names ${name}`).toBe(true);
      }
    }
    const index = renderGuide().text;
    for (const tool of aiEngineerTools.slice(2)) expect(index, `index names ${tool.name}`).toContain(tool.name);
  });
});

describe("MCP protocol", () => {
  it("lists every tool with a short description and a typed input, in a small tools/list", async () => {
    const client = await connect({ port: new RecordingPort(), localFiles: false });
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(surfaceTools.map((tool) => tool.name));
    for (const tool of tools) {
      expect(tool.description?.trim().length ?? 0, tool.name).toBeGreaterThan(20);
      expect(tool.description?.length ?? 0, tool.name).toBeLessThanOrEqual(160);
      expect(tool.inputSchema.type).toBe("object");
    }
    expect(estimateTokens(JSON.stringify(tools))).toBeLessThan(7500);
    await client.close();
  });

  it("returns the guide as plain text within its budget and errors as product error bodies", async () => {
    const client = await connect({ port: new RecordingPort(), localFiles: false });
    const guide = await callText(client, "aieng_guide", {});
    expect(guide.isError).toBe(false);
    expect(guide.text.startsWith("# AI Engineer: start here")).toBe(true);
    expect(estimateTokens(guide.text)).toBeLessThanOrEqual(guideTokenBudgets.index);
    const described = await callText(client, "aieng_describe", { ref: "get_claim" });
    expect(JSON.parse(described.text).operation).toBe("get_claim");
    const unavailable = await callText(client, "schema_search", { query: "claims" });
    expect(unavailable.isError).toBe(true);
    expect(JSON.parse(unavailable.text)).toMatchObject({ code: "NOT_AVAILABLE", message: "NOT_AVAILABLE" });
    await client.close();
  });
});

describe("authoring tools", () => {
  const ws = "0193e3c1-6f5a-7c3e-9a1b-2c3d4e5f6a70";
  const work = "0193e3c1-6f5a-7c3e-9a1b-2c3d4e5f6a71";
  const head = "0193e3c1-6f5a-7c3e-9a1b-2c3d4e5f6a72";
  const child = "0193e3c1-6f5a-7c3e-9a1b-2c3d4e5f6a73";
  const key = "0193e3c1-6f5a-7c3e-9a1b-2c3d4e5f6a74";
  const claim = "0193e3c1-6f5a-7c3e-9a1b-2c3d4e5f6a75";
  const body = { formatVersion: 2, blocks: [{ key, type: "text", content: { markdown: "A section." } }] };

  /** Answers the authoring reads and commands the way the database does, and records every call. */
  class AuthoringPort extends RecordingPort {
    override async command(operation: string, input: CommandInput): Promise<JsonObject> {
      await super.command(operation, input);
      if (operation === "ensure_personal_workspace") return { workspaceId: "personal" };
      if (operation === "create_thread") return { threadId: "thread-1" };
      if (operation === "append_message") return { messageId: "message-1", seq: 1, contextSnapshotId: "s1" };
      if (operation === "deliver_output") return { deliveryId: "delivery-1" };
      return { workId: work, revisionId: head };
    }
    override async read(operation: string, input: ReadInput): Promise<unknown> {
      await super.read(operation, input);
      if (operation === "list_works") {
        return [
          { id: work, kind: "module", slug: "reliable-tool-calls", head },
          { id: child, kind: "lesson", slug: "lesson-1", head: child },
        ];
      }
      if (operation === "get_revision") {
        return { id: head, workId: work, revisionNo: 2, title: "Reliable tool calls", body, contentSha256: "digest" };
      }
      if (operation === "get_report") {
        return {
          revisionId: head,
          workId: work,
          revisionNo: 2,
          title: "Reliable tool calls",
          body,
          blocks: [{ key, type: "text", parent: null, position: 0 }],
          assertions: [
            { assertionId: claim, blockKey: key, kind: "claim", statement: "s", supportStatus: "supported" },
          ],
          datasets: [],
        };
      }
      if (operation === "preview_exposure") {
        return {
          root_revision_id: head,
          ceiling: (input.payload as { ceiling: string }).ceiling,
          items: [
            { item_key: `rev:${head}`, kind: "revision", id: head, disposition: "include" },
            { item_key: "bind:1", kind: "claim", id: claim, disposition: "include" },
          ],
          blockers: [],
          closure_sha256: "c105e",
        };
      }
      if (operation === "get_thread") return { threadId: "thread-1", messages: [] };
      return [];
    }
  }

  const structure = {
    bindings: [{ local_key: "claim-1", relation: "supports", target: { kind: "claim", id: claim }, block_key: key }],
    parts: [
      { child_revision_id: child, occurrence_key: key },
      { child_revision_id: head, occurrence_key: claim, role: "optional" as const },
    ],
    outcomes: [
      { outcome_key: key, statement: "Adds an idempotency key", evidence_rule: { schema: "aieng.evidence-rule.v2" } },
    ],
    requirements: [
      {
        requirement_key: claim,
        kind: "mandatory_activity",
        occurrence_key: claim,
        rationale: "The activity proves the outcome",
        options: [
          {
            route: "standard",
            activity_revision_id: head,
            evidence_rule: { schema: "aieng.evidence-rule.v2" },
            approval_state: "proposed",
          },
        ],
      },
    ],
    prerequisites: [{ required_revision_id: child, strength: "recommended", rationale: "Tool calling first" }],
    runtime: [{ local_key: "py", kind: "language_runtime", name: "python", version_spec: ">=3.12" }],
    statements: [{ kind: "claim", statement: "A retry can apply twice.", support_status: "supported", block_key: key }],
  };

  it("draft_work creates a work with its structure, in the shape create_work accepts", async () => {
    const port = new AuthoringPort();
    await draftWork.run(
      { port, localFiles: false },
      {
        workspace_id: ws,
        kind: "module",
        slug: "reliable-tool-calls",
        title: "Reliable tool calls",
        blocks: [{ ...body.blocks[0], bindings: ["claim-1"] }],
        origin: "agent",
        ...structure,
      },
    );
    const call = port.commands[0];
    expect(call?.operation).toBe("create_work");
    const payload = call?.input.payload as { kind: string; revision: Record<string, unknown> };
    expect(payload.revision).toMatchObject({
      title: "Reliable tool calls",
      origin: "agent",
      bindings: structure.bindings,
      parts: [
        { child_revision_id: child, occurrence_key: key, ordinal: 0 },
        { child_revision_id: head, occurrence_key: claim, ordinal: 1, role: "optional" },
      ],
      outcomes: structure.outcomes,
      requirements: structure.requirements,
      prerequisites: structure.prerequisites,
      runtime: structure.runtime,
      assertions: structure.statements,
    });
    expect(payload.revision).not.toHaveProperty("statements");
    expect(operationCatalog.get("create_work")?.payload.safeParse(payload).success).toBe(true);
  });

  it("draft_work revises against the work's current head and leaves absent structure out", async () => {
    const port = new AuthoringPort();
    await draftWork.run({ port, localFiles: false }, { workspace_id: ws, work_id: work, title: "v2", markdown: "x" });
    expect(port.commands[0]).toMatchObject({ operation: "revise_work", input: { expectedHead: head } });
    const revised = port.commands[0]?.input.payload as { revision: Record<string, unknown> } | undefined;
    const revision = revised?.revision ?? {};
    expect(Object.keys(revision).sort()).toEqual(["body", "title"]);
    expect((revision.body as typeof body).blocks[0]?.key).toBe(key);
    await expect(
      draftWork.run({ port, localFiles: false }, { workspace_id: ws, work_id: claim, title: "x", markdown: "x" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("inspect_authoring reads the workspace, the works, one work, a revision, an exposure and a thread", async () => {
    const port = new AuthoringPort();
    const context = { port, localFiles: false };
    await expect(inspectAuthoring.run(context, { what: "workspace" })).resolves.toMatchObject({
      personal_workspace_id: "personal",
      shared_workspaces: expect.stringContaining("not listable"),
    });
    await expect(inspectAuthoring.run(context, { what: "works", workspace_id: ws, kind: "lesson" })).resolves.toEqual({
      workspace_id: ws,
      works: [{ id: child, kind: "lesson", slug: "lesson-1", head: child }],
    });
    const read = (await inspectAuthoring.run(context, { what: "work", workspace_id: ws, id: work })) as JsonObject;
    expect(read).toMatchObject({
      work: { id: work, kind: "module", head },
      revision_id: head,
      revision_no: 2,
      title: "Reliable tool calls",
      content_sha256: "digest",
      body,
      blocks: [{ key, type: "text" }],
      statements: [{ assertionId: claim, blockKey: key }],
      not_returned: ["bindings", "parts", "outcomes", "requirements", "prerequisites", "runtime"],
    });
    await expect(inspectAuthoring.run(context, { what: "revision", id: head })).resolves.toMatchObject({
      revision_id: head,
    });
    await expect(
      inspectAuthoring.run(context, { what: "exposure", workspace_id: ws, id: head }),
    ).resolves.toMatchObject({ ceiling: "workspace", closure_sha256: "c105e" });
    await inspectAuthoring.run(context, { what: "exposure", workspace_id: ws, id: head, ceiling: "named" });
    await expect(inspectAuthoring.run(context, { what: "thread", id: key })).resolves.toMatchObject({
      threadId: "thread-1",
    });
    expect(port.reads.map((call) => call.operation)).toEqual([
      "list_works",
      "list_works",
      "get_revision",
      "get_report",
      "get_revision",
      "get_report",
      "preview_exposure",
      "preview_exposure",
      "get_thread",
    ]);
    expect(port.reads.at(-2)?.input).toEqual({
      workspaceId: ws,
      payload: { root_revision_id: head, ceiling: "named" },
    });
    expect(port.commands.map((call) => call.operation)).toEqual(["ensure_personal_workspace"]);
    for (const what of ["works", "work", "revision", "exposure", "thread"] as const) {
      await expect(inspectAuthoring.run(context, { what }), what).rejects.toMatchObject({ code: "VALIDATION" });
    }
  });

  it("request_review leaves a note tied to the revision and records no review", async () => {
    const port = new AuthoringPort();
    const result = await requestReview.run(
      { port, localFiles: false },
      { workspace_id: ws, revision_id: head, note: "Submitted for review: module.", ceiling: "named" },
    );
    expect(result).toMatchObject({
      thread_id: "thread-1",
      message_id: "message-1",
      revision_id: head,
      ceiling: "named",
      closure_sha256: "c105e",
      items: 2,
      blockers: [],
      review: expect.stringContaining("not recorded"),
    });
    expect(result).not.toHaveProperty("delivery_id");
    expect(port.reads.map((call) => call.operation)).toEqual(["get_revision", "preview_exposure"]);
    expect(port.commands.map((call) => call.operation)).toEqual(["create_thread", "append_message"]);
    expect(port.commands[0]?.input).toMatchObject({
      workspaceId: ws,
      payload: { title: "Review request: Reliable tool calls", purpose: "authoring", visibility: "workspace" },
    });
    const message = port.commands[1]?.input.payload as {
      role: string;
      content: { schema: string; parts: { text: string }[] };
      context: { schema: string; items: unknown[] };
    };
    expect(message.role).toBe("assistant");
    expect(message.content.schema).toBe("aieng.message.v1");
    expect(message.content.parts[0]?.text).toContain("Submitted for review: module.");
    expect(message.content.parts[0]?.text).toContain(
      `Revision ${head}. Ceiling named. Closure c105e: 2 items, 0 blockers.`,
    );
    expect(message.context).toEqual({
      schema: "aieng.context.v1",
      view: "review_request",
      items: [{ item_key: "revision", reason: "attached", revision_id: head }],
    });
  });

  it("request_review delivers against an obligation first and can continue a thread", async () => {
    const port = new AuthoringPort();
    const result = await requestReview.run(
      { port, localFiles: false },
      { workspace_id: ws, revision_id: head, note: "Second hand-over.", thread_id: key, obligation_id: claim },
    );
    expect(result).toMatchObject({ thread_id: key, delivery_id: "delivery-1", ceiling: "workspace" });
    expect(port.commands.map((call) => call.operation)).toEqual(["deliver_output", "append_message"]);
    expect(port.commands[0]?.input.payload).toEqual({ obligation_id: claim, revision_id: head });
    const sent = port.commands[1]?.input.payload as { content: { parts: { text: string }[] } } | undefined;
    const text = sent?.content.parts[0]?.text;
    expect(text).toContain("Delivered as delivery-1.");
  });

  it("no tool reaches the review, freeze and offer operations that people decide", async () => {
    const port = new AuthoringPort();
    const context = { port, localFiles: false };
    await requestReview.run(context, { workspace_id: ws, revision_id: head, note: "n", obligation_id: claim });
    await draftWork.run(context, { workspace_id: ws, kind: "lesson", title: "t", markdown: "m" });
    const called = new Set(port.commands.map((call) => call.operation));
    for (const operation of ["review_revision", "freeze_release", "open_distribution", "offer_release"]) {
      expect(called.has(operation), operation).toBe(false);
    }
  });
});

describe("skills through the guide tool", () => {
  it("aieng_guide returns a skill and a reference as the file's Markdown", async () => {
    const context = { port: new RecordingPort(), localFiles: false };
    for (const topic of skillTopics) {
      await expect(aiengGuide.run(context, { topic }), topic).resolves.toBe(renderGuide(topic).text);
    }
    await expect(aiengGuide.run(context, { topic: "content-authoring" })).resolves.toContain("# Content authoring");
    const client = await connect(context);
    const listed = (await client.listTools()).tools.find((tool) => tool.name === "aieng_guide");
    const topic = listed?.inputSchema.properties?.topic as { enum?: string[] } | undefined;
    const topics = topic?.enum ?? [];
    expect(topics).toEqual([guideIndexTopic, ...guideTopicNames]);
    expect(topics).toContain("content-authoring/references/lesson-craft");
    const reference = await callText(client, "aieng_guide", { topic: "content-authoring/references/lesson-craft" });
    expect(reference.isError).toBe(false);
    expect(reference.text.startsWith("# Lesson craft")).toBe(true);
    await client.close();
  });

  it("names, in every skill page, only tools this server registers and operations the catalog has", () => {
    const tools = new Set(aiEngineerTools.map((tool) => tool.name));
    const operations = new Set(publicOperations().map((operation) => operation.name));
    for (const topic of skillTopics) {
      for (const name of scanGuideReferences(renderGuide(topic).text).names) {
        expect(tools.has(name) || operations.has(name), `${topic} names ${name}`).toBe(true);
      }
    }
  });
});
