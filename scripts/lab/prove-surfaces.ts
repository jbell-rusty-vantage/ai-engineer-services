/**
 * Proves the real product surfaces on the disposable lab stack:
 *   - local MCP server (stdio, a separate process calling the running API) as the course author,
 *   - the HTTP API through the typed client for release and enrollment,
 *   - remote MCP server (streamable HTTP, in process over the application layer) as the learner,
 *   - the `aieng` CLI as a separate process.
 * Requires AIENG_API_URL (a running API) and the lab stack's AIENG_DB_URL / _PUBLISHABLE_KEY / _SECRET_KEY (docs/ENVIRONMENT.md maps `supabase status -o env`).
 * Content is labelled lab fixture data.
 */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  checkMode,
  createDatabaseReleaseCheck,
  createProductService,
  type ServiceConfig,
} from "@aiengineer/service-application";
import { AiEngineerClient } from "@aiengineer/service-client";
import { aiEngineerTools, buildRemoteMcpHost } from "@aiengineer/service-mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createLabUser, readLabEnvironment, runWorker } from "./lab-environment.js";

const run = promisify(execFile);
const repository = new URL("../../", import.meta.url);
const checks: { check: string; pass: boolean; detail?: string }[] = [];

function record(check: string, pass: boolean, detail?: string): void {
  checks.push({ check, pass, ...(detail ? { detail } : {}) });
  process.stdout.write(`${pass ? "PASS" : "FAIL"} ${check}${!pass && detail ? ` — ${detail}` : ""}\n`);
}

interface ToolOutcome {
  readonly isError: boolean;
  readonly value: Record<string, unknown> & { code?: string };
}

async function callTool(client: Client, name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: { text: string }[];
  };
  return { isError: result.isError === true, value: JSON.parse(result.content[0]?.text ?? "null") };
}

async function writeSite(directory: string): Promise<void> {
  await mkdir(join(directory, "styles"), { recursive: true });
  await writeFile(
    join(directory, "index.html"),
    "<!doctype html><link rel=stylesheet href=styles/site.css><script src=app.js></script>",
  );
  await writeFile(join(directory, "app.js"), "console.log('retry simulator');");
  await writeFile(join(directory, "styles", "site.css"), "body { font: 16px sans-serif; }");
}

const apiUrl = process.env.AIENG_API_URL ?? "http://127.0.0.1:3200";
const lab = readLabEnvironment();
const author = await createLabUser(lab, "surface-author");
const learner = await createLabUser(lab, "surface-learner");
const authorApi = new AiEngineerClient({ baseUrl: apiUrl, accessToken: author.accessToken });
const learnerApi = new AiEngineerClient({ baseUrl: apiUrl, accessToken: learner.accessToken });
const siteDirectory = await mkdtemp(join(tmpdir(), "aieng-site-"));
await writeSite(siteDirectory);

// ------------------------------------------------------------------ author through the local stdio MCP server
const workspaceId = String(
  (await authorApi.command("create_workspace", { workspaceId: null, payload: { name: "Surface proof course" } }))
    .workspaceId,
);
const localMcp = new Client({ name: "surface-proof-local", version: "0.1.0" });
await localMcp.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [new URL("apps/mcp/dist/stdio.js", repository).pathname.replace(/^\/([A-Za-z]:)/, "$1")],
    env: { ...process.env, AIENG_API_URL: apiUrl, AIENG_ACCESS_TOKEN: author.accessToken } as Record<string, string>,
  }),
);
const toolNames = (await localMcp.listTools()).tools.map((tool) => tool.name).sort();
record(
  `local MCP lists the ${aiEngineerTools.length} curated tools`,
  toolNames.length === aiEngineerTools.length,
  toolNames.join(","),
);

// ------------------------------------------------------------------ research loop through the local MCP tools (Build 07)
const brief = await callTool(localMcp, "draft_work", {
  workspace_id: workspaceId,
  kind: "brief",
  slug: "surface-research",
  title: "Which API is cheapest per million output tokens?",
  markdown: "Compare two offerings.",
  metadata: {
    research: {
      schema: "aieng.research-brief.v1",
      question: "Which API is cheapest per million output tokens?",
      plan: ["Read pricing pages", "Record prices"],
      budget_limit_usd: 0,
      obligations: [{ key: "prices", form: "dataset", enforcement: "required", expected_work_kind: "dataset" }],
    },
  },
});
const proposal = await callTool(localMcp, "propose_research", {
  workspace_id: workspaceId,
  revision_id: brief.value.revisionId,
});
const acceptance = await authorApi.command("accept_research", {
  workspaceId,
  payload: { revision_id: brief.value.revisionId, execution_origin: "native_harness" },
});
const priceField = crypto.randomUUID();
const rowKey = crypto.randomUUID();
const dataset = await authorApi.command("create_dataset", {
  workspaceId,
  payload: {
    slug: "surface-prices",
    title: "Output prices",
    fields_add: [{ field_key: priceField, name: "output_usd_per_mtok", value_type: "number", meaning: "Output price" }],
    rows_add: [{ row_key: rowKey, label: "example model" }],
    cells: [{ row_key: rowKey, field_key: priceField, value: 10, value_status: "observed" }],
  },
});
const changeArguments = {
  workspace_id: workspaceId,
  dataset_work_id: dataset.workId,
  mode: "proposal",
  base_revision_no: 1,
  reason: "correction",
  dedupe_key: "surface-correction",
  cells: [{ row_key: rowKey, field_key: priceField, value: 12, value_status: "observed" }],
};
const change = await callTool(localMcp, "update_dataset", changeArguments);
const repeated = await callTool(localMcp, "update_dataset", changeArguments);
const statementSource = await callTool(localMcp, "draft_work", {
  workspace_id: workspaceId,
  kind: "document",
  slug: "surface-source",
  title: "Example pricing page",
  markdown: "Output: $10 per 1M tokens",
});
const cited = await callTool(localMcp, "cite_evidence", {
  workspace_id: workspaceId,
  dataset_work_id: dataset.workId,
  row_key: rowKey,
  role: "supports",
  source_revision_id: statementSource.value.revisionId,
  quotes: ["Output: $10 per 1M tokens"],
});
const delivered = await callTool(localMcp, "deliver_output", {
  workspace_id: workspaceId,
  obligation_id: (acceptance.obligations as Record<string, string>).prices,
  revision_id: dataset.revisionId,
});
const status = await callTool(localMcp, "inspect_research", {
  workspace_id: workspaceId,
  what: "acceptance",
  id: acceptance.acceptanceId,
});
record(
  "local MCP research loop: propose, stage a reviewed change (repeat is a duplicate), cite a source, deliver, inspect",
  proposal.value.valid === true &&
    !change.isError &&
    repeated.value.duplicate === true &&
    !cited.isError &&
    !delivered.isError &&
    (status.value.obligations as { deliveries: unknown[] }[])[0]?.deliveries.length === 1,
  JSON.stringify({ proposal: proposal.value, change: change.value, status: status.value.state }),
);

const site = await callTool(localMcp, "publish_built_site", { workspace_id: workspaceId, directory: siteDirectory });
record(
  "local MCP publishes a harness-built folder as a 3-file set with an isolated preview URL",
  !site.isError &&
    site.value.files === 3 &&
    String(site.value.url).startsWith(`https://${site.value.deploymentId}.preview.`),
  JSON.stringify(site.value),
);

const textKey = crypto.randomUUID();
const siteKey = crypto.randomUUID();
const lessonBlocks = (text: string) => [
  { key: textKey, type: "text", content: { markdown: text } },
  { key: siteKey, type: "embedded_site", fallback: "Retry simulator (open the link)", bindings: ["site"] },
];
const siteBinding = [
  {
    local_key: "site",
    relation: "representation",
    role: "build",
    target: { kind: "file_set", id: site.value.fileSetId },
    usage: "redistributable",
  },
];
const lesson = await callTool(localMcp, "draft_work", {
  workspace_id: workspaceId,
  kind: "lesson",
  slug: "retry-simulator",
  title: "Retry simulator",
  blocks: lessonBlocks("Watch a retry duplicate a write."),
  bindings: siteBinding,
});
const revised = await callTool(localMcp, "draft_work", {
  workspace_id: workspaceId,
  work_id: lesson.value.workId,
  title: "Retry simulator",
  blocks: lessonBlocks("Watch a retry duplicate a write, then fix it."),
  bindings: siteBinding,
});
record(
  "local MCP drafts a lesson with an embedded site, then revises it against the current head",
  !lesson.isError && !revised.isError && revised.value.workId === lesson.value.workId,
  JSON.stringify(revised.value),
);
await localMcp.close();

// ------------------------------------------------------------------ release and enrollment through the HTTP API client
const lessonRevision = String(revised.value.revisionId);
const course = await authorApi.command("create_work", {
  workspaceId,
  payload: {
    kind: "course",
    slug: "surface-proof",
    revision: {
      title: "Surface proof course",
      body: { formatVersion: 2, blocks: [{ key: crypto.randomUUID(), type: "text", content: { markdown: "Course" } }] },
      parts: [{ occurrence_key: crypto.randomUUID(), child_revision_id: lessonRevision, ordinal: 0 }],
    },
  },
});
const exposure = (await authorApi.read("preview_exposure", {
  workspaceId,
  payload: { root_revision_id: course.revisionId, ceiling: "named" },
})) as { closure_sha256: string; blockers: unknown[] };
const review = await authorApi.command("review_revision", {
  workspaceId,
  payload: {
    work_id: course.workId,
    revision_id: course.revisionId,
    review: {
      reviewType: "release_review",
      decision: "approve",
      closure_sha256: exposure.closure_sha256,
      ceiling: "named",
    },
  },
});
const release = await authorApi.command("freeze_release", {
  workspaceId,
  payload: { root_revision_id: course.revisionId, ceiling: "named", approval_event_id: review.eventId },
});
const distribution = await authorApi.command("open_distribution", {
  workspaceId,
  payload: { root_work_id: course.workId, channel: "invited", title: "Surface cohort" },
});
await authorApi.command("grant_reader", {
  workspaceId,
  payload: { distribution_id: distribution.distributionId, principal_id: learner.id },
});
const terms = {
  study: true,
  adapt: "private",
  redistribute: "none",
  derived_work: "none",
  attribution: "lab",
  updates: "corrections_included",
  endorsement: "creator",
};
const offer = await authorApi.command("offer_release", {
  workspaceId,
  payload: {
    distribution_id: distribution.distributionId,
    release_id: release.releaseId,
    terms,
    approval_event_id: review.eventId,
  },
});
record(
  "API freezes the release and stores its manifest itself (offer accepted without a worker step)",
  Boolean(offer.offerId),
);
await runWorker(lab, "index_passages", {
  workspace_id: workspaceId,
  revision_id: lessonRevision,
  procedure_version: "surface-proof-1",
  passages: [
    {
      text: "A retry without an idempotency key duplicates the write in the simulator.",
      locator: { schema: "aieng.locator.v1", block: textKey },
    },
  ],
});
const learnerWorkspace = String(
  (await learnerApi.command("ensure_personal_workspace", { workspaceId: null, payload: {} })).workspaceId,
);
const enrollment = await learnerApi.command("enroll", {
  workspaceId: learnerWorkspace,
  payload: { distribution_id: distribution.distributionId },
});
await learnerApi.command("adopt_release", {
  workspaceId: learnerWorkspace,
  payload: { enrollment_id: enrollment.enrollmentId, offer_id: offer.offerId },
});
const offerView = (await learnerApi.read("get_offer", { payload: { offer_id: offer.offerId } })) as {
  items: { releaseItemId: string; revisionId: string | null }[];
};
const lessonItem = offerView.items.find((item) => item.revisionId === lessonRevision)?.releaseItemId;
record("API read returns the release item ids a client needs", Boolean(lessonItem));

// ------------------------------------------------------------------ learner through the remote MCP server (no local files)
// The host runs the startup release check of the entry points: the lab must be stamped with the pinned release
// (or AIENG_DB_RELEASE_CHECK=warn for a lab that is not).
const labConfig: ServiceConfig = {
  databaseUrl: lab.databaseUrl,
  databasePublishableKey: lab.publishableKey,
  databaseSecretKey: lab.secretKey,
  databaseReleaseCheck: checkMode(process.env),
};
const remoteHost = buildRemoteMcpHost({
  service: createProductService(labConfig),
  databaseRelease: createDatabaseReleaseCheck(labConfig),
});
await remoteHost.listen({ host: "127.0.0.1", port: 0 });
const remoteUrl = `http://127.0.0.1:${(remoteHost.server.address() as AddressInfo).port}/mcp`;
const unauthenticated = await fetch(remoteUrl, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{}",
});
record("remote MCP refuses requests without a bearer token", unauthenticated.status === 401);
const remoteMcp = new Client({ name: "surface-proof-remote", version: "0.1.0" });
await remoteMcp.connect(
  new StreamableHTTPClientTransport(new URL(remoteUrl), {
    requestInit: { headers: { authorization: `Bearer ${learner.accessToken}` } },
  }),
);

const lessonView = await callTool(remoteMcp, "read_lesson", { revision_id: lessonRevision });
const blocks = (lessonView.value.blocks ?? []) as { key: string; type: string }[];
record(
  "remote MCP renders the released lesson with its embedded site block",
  blocks.some((block) => block.key === siteKey && block.type === "embedded_site"),
);
const annotation = await callTool(remoteMcp, "annotate_lesson_block", {
  release_item_id: lessonItem,
  block_key: siteKey,
  title: "My simulator notes",
  markdown: "The duplicate disappears once the key is stable.",
});
const annotatedView = await callTool(remoteMcp, "read_lesson", { revision_id: lessonRevision });
const layer = (annotatedView.value.learnerLayer ?? []) as { blockKey: string }[];
record(
  "remote MCP saves a private annotation that appears on the exact block",
  !annotation.isError && layer.length === 1 && layer[0]?.blockKey === siteKey,
);
const hits = await callTool(remoteMcp, "search_learning", { query: "idempotency key duplicates" });
record(
  "remote MCP search returns the released lesson as course material",
  Array.isArray(hits.value) && (hits.value as { label: string }[]).some((hit) => hit.label === "course_material"),
);
const refusedFolder = await callTool(remoteMcp, "publish_built_site", {
  workspace_id: learnerWorkspace,
  directory: siteDirectory,
});
record("remote MCP refuses to read local folders", refusedFolder.isError && refusedFolder.value.code === "FORBIDDEN");
const progress = await callTool(remoteMcp, "check_progress", { enrollment_id: enrollment.enrollmentId });
record("remote MCP reports course progress", progress.value.enrollmentId === enrollment.enrollmentId);
const attempt = await callTool(remoteMcp, "start_attempt", {
  purpose: "practice",
  facet: "assisted",
  task_release_item_id: lessonItem,
});
const submission = await callTool(remoteMcp, "submit_attempt", {
  attempt_id: attempt.value.attemptId,
  items: [{ item_key: "notes", kind: "response", revision_id: annotation.value.revisionId }],
});
record(
  "remote MCP starts and submits a practice attempt (manifest stored in process)",
  !attempt.isError && !submission.isError && Boolean(submission.value.submissionId),
  JSON.stringify(submission.value),
);
await remoteMcp.close();
await remoteHost.close();

// ------------------------------------------------------------------ the aieng CLI as a separate process
const cli = new URL("apps/cli/dist/main.js", repository).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const cliEnvironment = { ...process.env, AIENG_API_URL: apiUrl, AIENG_ACCESS_TOKEN: learner.accessToken };
const operations = JSON.parse((await run(process.execPath, [cli, "operations"], { env: cliEnvironment })).stdout) as {
  name: string;
}[];
record(
  "CLI lists the public operation catalog",
  operations.some((operation) => operation.name === "search") &&
    !operations.some((operation) => operation.name === "register_asset"),
);
const cliSearch = JSON.parse(
  (await run(process.execPath, [cli, "search", "idempotency key duplicates"], { env: cliEnvironment })).stdout,
) as { label: string }[];
record(
  "CLI search matches the MCP search",
  cliSearch.some((hit) => hit.label === "course_material"),
);
const cliSite = JSON.parse(
  (
    await run(process.execPath, [cli, "site", "publish", siteDirectory, "--workspace", learnerWorkspace], {
      env: cliEnvironment,
    })
  ).stdout,
) as { files: number };
record("CLI publishes a local site into the learner's personal workspace", cliSite.files === 3);
const failed = await run(process.execPath, [cli, "command", "drop_everything"], { env: cliEnvironment }).then(
  () => undefined,
  (error: { code: number; stderr: string }) => error,
);
record(
  "CLI reports unknown operations as a product error with a non-zero exit",
  failed?.code === 1 && JSON.parse(failed.stderr).code === "UNKNOWN_OPERATION",
);

await rm(siteDirectory, { recursive: true, force: true });
const passed = checks.filter((check) => check.pass).length;
await mkdir(new URL("lab-results/", repository), { recursive: true });
await writeFile(
  new URL("lab-results/surfaces.json", repository),
  JSON.stringify({ ranAt: new Date().toISOString(), passed, failed: checks.length - passed, checks }, null, 2),
);
process.stdout.write(`\n${passed} passed, ${checks.length - passed} failed\n`);
process.exitCode = passed === checks.length ? 0 : 1;
