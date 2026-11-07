import { describe, expect, it } from "vitest";
import { AiEngineerClient } from "./ai-engineer-client.js";
import { mediaTypeForPath } from "./site-publisher.js";

function fakeFetch(
  status: number,
  body: unknown,
  seen: { url?: string; headers?: Record<string, string> } = {},
): typeof fetch {
  return (async (url: string, init: { headers: Record<string, string> }) => {
    seen.url = url;
    seen.headers = init.headers;
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
}

describe("AiEngineerClient", () => {
  it("sends commands with the user and client tokens", async () => {
    const seen: { url?: string; headers?: Record<string, string> } = {};
    const client = new AiEngineerClient({
      baseUrl: "http://api.test/",
      accessToken: "user",
      clientToken: "grant",
      fetch: fakeFetch(200, { ok: true }, seen),
    });
    await client.command("create_thread", { workspaceId: null, payload: { title: "x", purpose: "general" } });
    expect(seen.url).toBe("http://api.test/v1/commands/create_thread");
    expect(seen.headers?.authorization).toBe("Bearer user");
    expect(seen.headers?.["x-aieng-client-token"]).toBe("grant");
  });

  it("raises product errors from the API body", async () => {
    const client = new AiEngineerClient({
      baseUrl: "http://api.test",
      accessToken: "user",
      fetch: fakeFetch(404, { code: "NOT_FOUND", message: "NOT_FOUND" }),
    });
    await expect(client.read("get_thread", { payload: { thread_id: "x" } })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("mediaTypeForPath", () => {
  it("knows common site files", () => {
    expect(mediaTypeForPath("index.html")).toBe("text/html");
    expect(mediaTypeForPath("assets/app.JS")).toBe("text/javascript");
    expect(mediaTypeForPath("blob.bin")).toBe("application/octet-stream");
  });
});
