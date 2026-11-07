import { AiEngineerClient } from "@aiengineer/service-client";
import { describe, expect, it } from "vitest";
import { runCommand } from "./commands.js";

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
