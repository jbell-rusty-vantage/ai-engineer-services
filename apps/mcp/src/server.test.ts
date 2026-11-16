import {
  type AssetUploadResult,
  type CommandInput,
  estimateTokens,
  guideIndexTopic,
  guideTokenBudgets,
  guideTopics,
  type JsonObject,
  type ProductPort,
  publicOperations,
  type ReadInput,
  renderGuide,
  type SchemaPort,
  scanGuideReferences,
  surfaceTools,
} from "@aiengineer/service-contracts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { aiEngineerTools, createAiEngineerMcpServer } from "./server.js";
import { publishBuiltSite } from "./tools/authoring-tools.js";
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
    expect(names.length).toBeLessThanOrEqual(20);
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
    expect(estimateTokens(JSON.stringify(tools))).toBeLessThan(6000);
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
