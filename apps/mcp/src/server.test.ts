import type {
  AssetUploadResult,
  CommandInput,
  JsonObject,
  ProductPort,
  ReadInput,
} from "@aiengineer/service-contracts";
import { describe, expect, it } from "vitest";
import { aiEngineerTools } from "./server.js";
import { publishBuiltSite } from "./tools/authoring-tools.js";
import { citeEvidence, inspectResearch, updateDataset } from "./tools/research-tools.js";

class RecordingPort implements ProductPort {
  readonly commands: { operation: string; input: CommandInput }[] = [];
  async command(operation: string, input: CommandInput): Promise<JsonObject> {
    this.commands.push({ operation, input });
    if (operation === "ensure_personal_workspace") return { workspaceId: "personal" };
    if (operation === "register_file_set") return { fileSetId: "fs1", treeSha256: "t" };
    if (operation === "record_deployment")
      return { deploymentId: "d1", url: "https://d1.preview.example", status: "pending" };
    return { ok: true };
  }
  async read(_operation: string, _input: ReadInput): Promise<unknown> {
    return [];
  }
  async uploadAsset(): Promise<AssetUploadResult> {
    return { artifactId: `a${this.commands.length}`, sha256: "s", sizeBytes: 1 };
  }
}

describe("MCP tools", () => {
  it("exposes a small, uniquely named, task-shaped set", () => {
    const names = aiEngineerTools.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBeLessThanOrEqual(16);
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
