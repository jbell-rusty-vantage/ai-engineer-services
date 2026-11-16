import { AiEngineerClient } from "@aiengineer/service-client";
import { commandUsage, surfaceCommands } from "@aiengineer/service-contracts";
import { describe, expect, it } from "vitest";
import { isReferenceCommand, runCommand, runReferenceCommand, usage } from "./commands.js";

function client(seen: { url?: string; body?: unknown }) {
  const fetchImpl = (async (url: string, init: { body?: string }) => {
    seen.url = url;
    seen.body = init.body ? JSON.parse(init.body) : undefined;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof fetch;
  return new AiEngineerClient({ baseUrl: "http://api.test", accessToken: "user", fetch: fetchImpl });
}

describe("aieng commands", () => {
  it("runs a command with a JSON payload", async () => {
    const seen: { url?: string; body?: unknown } = {};
    await runCommand(client(seen), ["command", "create_thread"], {
      workspace: "w1",
      payload: '{"title":"x","purpose":"general"}',
    });
    expect(seen.url).toBe("http://api.test/v1/commands/create_thread");
    expect(seen.body).toMatchObject({ workspaceId: "w1", payload: { title: "x", purpose: "general" } });
  });

  it("searches", async () => {
    const seen: { url?: string; body?: unknown } = {};
    await runCommand(client(seen), ["search", "idempotency keys"], { limit: "5" });
    expect(seen.body).toMatchObject({ payload: { query: "idempotency keys", limit: 5 } });
  });

  it("rejects unknown commands and bad options", async () => {
    await expect(runCommand(client({}), ["dance"], {})).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      runCommand(client({}), ["upload", "x.txt"], { workspace: "w", usage: "everything", rights: "r" }),
    ).rejects.toBeDefined();
  });
});

const id = "0193e3c1-6f5a-7c3e-9a1b-2c3d4e5f6a7b";

describe("aieng knowledge", () => {
  it("searches the knowledge base with the filters given as options", async () => {
    const seen: { url?: string; body?: unknown } = {};
    await runCommand(client(seen), ["knowledge", "search", "structured output retries"], {
      lens: "evidence",
      tier: "0,2",
      space: "assertions",
      kind: "claim,summary",
      "as-of": "2026-11-01T00:00:00Z",
      limit: "5",
      collapse: false,
    });
    expect(seen.url).toBe("http://api.test/v1/reads/search_knowledge");
    expect(seen.body).toEqual({
      workspaceId: null,
      payload: {
        query: "structured output retries",
        lenses: ["evidence"],
        tiers: [0, 2],
        spaces: ["assertions"],
        kinds: ["claim", "summary"],
        as_of: "2026-11-01T00:00:00Z",
        limit: 5,
        collapse: false,
      },
    });
    await runCommand(client(seen), ["knowledge", "search", "retries"], {});
    expect(seen.body).toEqual({ workspaceId: null, payload: { query: "retries" } });
  });

  it("reads a claim, an entity, a source and what is due", async () => {
    const seen: { url?: string; body?: { payload?: unknown } } = {};
    const run = (positionals: string[], options = {}) => runCommand(client(seen), positionals, options);
    await run(["knowledge", "claim", id]);
    expect(seen.url).toBe("http://api.test/v1/reads/get_claim");
    expect(seen.body?.payload).toEqual({ claim_id: id });
    await run(["knowledge", "entity"], { library: "langgraph" });
    expect(seen.body?.payload).toEqual({ library: "langgraph" });
    await run(["knowledge", "entity", id]);
    expect(seen.body?.payload).toEqual({ entity_id: id });
    await run(["knowledge", "source"], { name: "A. Author" });
    expect(seen.url).toBe("http://api.test/v1/reads/get_source");
    expect(seen.body?.payload).toEqual({ name: "A. Author" });
    await run(["knowledge", "due"], { since: "2026-11-01T00:00:00Z", release: id });
    expect(seen.url).toBe("http://api.test/v1/reads/list_due");
    expect(seen.body?.payload).toEqual({ since: "2026-11-01T00:00:00Z", release_id: id });
  });

  it("reads the evidence behind an entity's facts, an entity's changes and a summary's sources", async () => {
    const seen: { url?: string; body?: { payload?: unknown } } = {};
    const run = (positionals: string[], options = {}) => runCommand(client(seen), positionals, options);
    await run(["knowledge", "facts", id], {
      kind: "offering_price",
      scope: "input_tokens|standard|short|",
      limit: "3",
    });
    expect(seen.url).toBe("http://api.test/v1/reads/get_fact_evidence");
    expect(seen.body?.payload).toEqual({
      entity_id: id,
      stream_kind: "offering_price",
      scope_key: "input_tokens|standard|short|",
      limit: 3,
    });
    await run(["knowledge", "changes", id], { after: "0", through: "270" });
    expect(seen.url).toBe("http://api.test/v1/reads/list_entity_changes");
    expect(seen.body?.payload).toEqual({ entity_id: id, after_seq: 0, through_seq: 270 });
    await run(["knowledge", "changes", id]);
    expect(seen.body?.payload).toEqual({ entity_id: id });
    await run(["knowledge", "summary", id]);
    expect(seen.url).toBe("http://api.test/v1/reads/get_summary_evidence");
    expect(seen.body?.payload).toEqual({ summary_id: id });
    await expect(run(["knowledge", "facts", id])).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("refuses a missing argument or an unknown verb before calling the API", async () => {
    const seen: { url?: string } = {};
    await expect(runCommand(client(seen), ["knowledge", "claim"], {})).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(runCommand(client(seen), ["knowledge", "dance"], {})).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(runCommand(client(seen), ["knowledge", "search", "x"], { limit: "many" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    expect(seen.url).toBeUndefined();
  });
});

describe("aieng schema", () => {
  it("searches the schema and prints a page as text with the workspace head", async () => {
    const seen: { url?: string } = {};
    const page = {
      head: { migration_head: "20261115120100", contract_version: "0.6.0", fingerprint: "sha256:fixture" },
      page: "START_HERE.md",
      bytes: 12,
      truncated: false,
      text: "# Start here",
    };
    const fetchImpl = (async (url: string) => {
      seen.url = url;
      return new Response(JSON.stringify(page), { status: 200 });
    }) as unknown as typeof fetch;
    const api = new AiEngineerClient({ baseUrl: "http://api.test", accessToken: "user", fetch: fetchImpl });
    await runCommand(api, ["schema", "search", "verified claims"], { kind: "view", limit: "3" });
    expect(seen.url).toBe("http://api.test/v1/schema/search?query=verified+claims&limit=3&kind=view");
    const text = await runCommand(api, ["schema", "get"], {});
    expect(seen.url).toBe("http://api.test/v1/schema/pages");
    expect(text).toBe(
      "schema workspace: migration head 20261115120100, contract 0.6.0, fingerprint sha256:fixture (page START_HERE.md, 12 bytes)\n\n# Start here",
    );
    await expect(runCommand(api, ["schema", "list"], {})).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("aieng guide and describe", () => {
  it("answer from the built-in catalog, without the API", () => {
    expect(isReferenceCommand("guide")).toBe(true);
    expect(isReferenceCommand("describe")).toBe(true);
    expect(isReferenceCommand("search")).toBe(false);
    expect(runReferenceCommand(["guide"])).toContain("# AI Engineer: start here");
    expect(runReferenceCommand(["guide", "knowledge"])).toContain("search_knowledge");
    expect(runReferenceCommand(["describe", "list_due"])).toMatchObject({ operation: "list_due", kind: "read" });
    expect(() => runReferenceCommand(["describe"])).toThrowError(/VALIDATION/);
    expect(() => runReferenceCommand(["guide", "cooking"])).toThrowError(/NOT_FOUND/);
  });

  it("lists every catalogued command in the usage text and implements each one", async () => {
    for (const command of surfaceCommands) {
      expect(usage).toContain(commandUsage(command));
      // Without its arguments a known command fails on what is missing, never as an unknown command.
      const outcome = await runCommand(client({}), command.path, {}).then(
        () => "ran",
        (error: { detail?: string }) => error.detail ?? "",
      );
      expect(outcome, command.path.join(" ")).not.toContain("unknown command");
    }
  });
});
