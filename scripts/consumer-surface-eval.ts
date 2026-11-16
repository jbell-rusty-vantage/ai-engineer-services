/**
 * Consumer-surface evaluation: can an agent answer the owner's questions from this service?
 *
 * It asks the questions an agent comes with through the consumer paths:
 *   - `mcp`:  an agent with no compute environment, which has the remote MCP server and nothing else;
 *   - `http`: a sandboxed agent, whose `aieng` CLI is a thin client over these same routes;
 *   - `cli`:  the `aieng` command itself, for the start page and the usage text.
 * For each question it checks that the tool exists, has a description and a typed input, and returns a non-empty,
 * small answer (the token estimate is reported), and that the guide names only tools, operations and commands that
 * exist. Every check is deterministic and read-only: no model call, nothing paid, no product write.
 *
 * The API and the remote MCP server are built in process on loopback ports, the way `scripts/lab/prove-surfaces.ts`
 * builds the remote MCP host. Run `pnpm build` first (the CLI is run from `apps/cli/dist`).
 *
 *   pnpm eval:consumer-surface                      database from AIENG_DB_* (the lab stack), session from AIENG_ACCESS_TOKEN
 *   pnpm eval:consumer-surface --without-database   knowledge answers are reported as not run; everything else runs
 *
 * Options: --query <keywords> (default "agent"), --claim <claim-id>, --source <name>, --strict (exit 1 on a failure).
 * Without AIENG_ACCESS_TOKEN a lab user is created, and only when AIENG_DB_URL is a loopback lab stack (that Auth
 * user is the one thing this script ever writes). Credentials are never printed. The result is a scorecard, not a
 * gate: it records what the surface answers today so a change can be measured.
 */
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { parseArgs, promisify } from "node:util";
import {
  createProductService,
  createSchemaWorkspace,
  type DatabaseGateway,
  loadServiceConfig,
  type ObjectStorage,
  ProductService,
} from "@aiengineer/service-application";
import { buildRemoteMcpHost } from "@aiengineer/service-mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
// The root package does not link these two workspace packages, so they are imported from their build output.
import { buildApiServer } from "../apps/api/dist/server.js";
import {
  estimateTokens,
  guideTokenBudgets,
  ProductError,
  scanGuideReferences,
  schemaPageByteLimit,
} from "../packages/contracts/dist/index.js";
import { createLabUser, readLabEnvironment } from "./lab/lab-environment.js";

const run = promisify(execFile);
const repository = new URL("../", import.meta.url);
const { values } = parseArgs({
  // pnpm forwards a literal `--` before script arguments; it is not one of ours.
  args: process.argv.slice(2).filter((argument) => argument !== "--"),
  options: {
    "without-database": { type: "boolean" },
    strict: { type: "boolean" },
    query: { type: "string" },
    claim: { type: "string" },
    source: { type: "string" },
  },
});

const options = { ...values, withoutDatabase: values["without-database"] === true };

const questions = {
  tools: "Is every tool self-explanatory?",
  start: "Where do I start, and which tool do I use for which job?",
  find: "How do I find what the knowledge base already knows about a topic, and how well it is supported?",
  claim: "How do I read one verified claim with its evidence and verdicts?",
  source: "How do I read one source and its track record?",
  due: "What is stale or due for review?",
  schema: "How do I navigate the schema to find where something lives?",
  author: "How do I create a course, a module, a lesson, an activity or an artifact, and release it?",
} as const;

/** Answer sizes an agent can afford, in estimated tokens. */
const budgets = { search: 1500, record: 2000, schemaSearch: 800, schemaPage: Math.ceil(schemaPageByteLimit / 4) + 400 };

type Path = "mcp" | "http" | "cli";
type Result = "pass" | "fail" | "not_run";

interface Check {
  readonly question: string;
  readonly path: Path;
  readonly result: Result;
  readonly observed: string;
  readonly wanted: string;
  readonly tokens?: number;
}

interface Answer {
  /** Parsed JSON, or the text itself when the answer is text. */
  readonly value: unknown;
  readonly text: string;
  readonly error?: { readonly code: string; readonly detail?: string };
}

interface ListedTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: { readonly properties?: Record<string, { type?: string; properties?: unknown }> };
}

const checks: Check[] = [];
const noAnswer: Answer = { value: null, text: "" };

function record(
  question: string,
  path: Path,
  passed: boolean | "not_run",
  observed: string,
  wanted: string,
  tokens?: number,
): void {
  const result: Result = passed === "not_run" ? "not_run" : passed ? "pass" : "fail";
  checks.push({ question, path, result, observed, wanted, ...(tokens === undefined ? {} : { tokens }) });
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorOf(value: unknown): NonNullable<Answer["error"]> {
  const body = value as { code?: unknown; detail?: unknown } | null;
  if (typeof body?.code !== "string") return { code: "UNKNOWN" };
  return { code: body.code, ...(typeof body.detail === "string" ? { detail: body.detail } : {}) };
}

const failure = (answer: Answer) => `${answer.error?.code}${answer.error?.detail ? `: ${answer.error.detail}` : ""}`;
const object = (value: unknown) => (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
const rows = (value: unknown) => (Array.isArray(value) ? (value as Record<string, unknown>[]) : []);

// ------------------------------------------------------------------ the service, in process on loopback
function serviceWithoutDatabase(): ProductService {
  const refuse = async (): Promise<never> => {
    throw new ProductError("UNAVAILABLE", "evaluation without a database");
  };
  const database: DatabaseGateway = { command: refuse, read: refuse, worker: refuse };
  const storage: ObjectStorage = { put: refuse, get: refuse };
  return new ProductService(database, storage);
}

const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

async function userSession(): Promise<string> {
  if (options.withoutDatabase) return "evaluation-without-database";
  const token = process.env.AIENG_ACCESS_TOKEN?.trim();
  if (token) return token;
  const lab = readLabEnvironment();
  if (!loopbackHosts.has(new URL(lab.databaseUrl).hostname)) {
    throw new Error(
      "SESSION_REQUIRED: set AIENG_ACCESS_TOKEN to a user session, or point AIENG_DB_URL at the loopback lab stack",
    );
  }
  return (await createLabUser(lab, "consumer-eval")).accessToken;
}

const accessToken = await userSession();
const service = options.withoutDatabase ? serviceWithoutDatabase() : createProductService(loadServiceConfig());
const schema = createSchemaWorkspace();
const authorization = { authorization: `Bearer ${accessToken}` };

const api = buildApiServer({ service, schema });
const mcpHost = buildRemoteMcpHost({ service, schema });
await api.listen({ host: "127.0.0.1", port: 0 });
await mcpHost.listen({ host: "127.0.0.1", port: 0 });
const apiUrl = `http://127.0.0.1:${(api.server.address() as AddressInfo).port}`;
const mcpUrl = `http://127.0.0.1:${(mcpHost.server.address() as AddressInfo).port}/mcp`;
const mcp = new Client({ name: "consumer-surface-eval", version: "0.1.0" });
await mcp.connect(new StreamableHTTPClientTransport(new URL(mcpUrl), { requestInit: { headers: authorization } }));

async function tool(name: string, args: Record<string, unknown>): Promise<Answer> {
  const result = (await mcp.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  const text = result.content[0]?.text ?? "";
  const value = parsed(text);
  return { value, text, ...(result.isError ? { error: errorOf(value) } : {}) };
}

async function http(method: "GET" | "POST", path: string, body?: unknown): Promise<Answer> {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: { ...authorization, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  const value = parsed(text);
  return { value, text, ...(response.ok ? {} : { error: errorOf(value) }) };
}

const read = (operation: string, payload: Record<string, unknown>) =>
  http("POST", `/v1/reads/${operation}`, { payload });

// ------------------------------------------------------------------ what exists on each transport
const listedTools = (await mcp.listTools()).tools as ListedTool[];
const toolNames = new Set(listedTools.map((listed) => listed.name));
const toolsTokens = estimateTokens(JSON.stringify(listedTools));
const catalog = rows(object((await http("GET", "/v1/operations")).value).operations);
const operationNames = new Set(catalog.map((entry) => String(entry.name)));
const cli = new URL("apps/cli/dist/main.js", repository).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const cliEnvironment = { ...process.env, AIENG_API_URL: apiUrl, AIENG_ACCESS_TOKEN: accessToken };
const cliUsage = (await run(process.execPath, [cli, "--help"], { env: cliEnvironment })).stdout.split("\n");

const untypedArguments = (listed: ListedTool) =>
  Object.entries(listed.inputSchema.properties ?? {})
    .filter(([, property]) => property.type === "object" && !property.properties)
    .map(([name]) => `${listed.name}.${name}`);

/** Why a tool cannot be used as it is listed, or an empty string. */
function toolProblem(...names: string[]): string {
  for (const name of names) {
    const listed = listedTools.find((candidate) => candidate.name === name);
    if (!listed) return `tool ${name} is not listed`;
    if (!listed.description?.trim()) return `tool ${name} has no description`;
    const untyped = untypedArguments(listed);
    if (untyped.length > 0) return `untyped object argument ${untyped.join(", ")}`;
  }
  return "";
}

/** Tools, operations and commands a guide page names that this server, catalog or CLI does not have. */
function unknownReferences(text: string): string[] {
  const references = scanGuideReferences(text);
  const names = references.names.filter((name) => !toolNames.has(name) && !operationNames.has(name));
  const commands = references.commands.filter((words) => {
    const inUsage = cliUsage.some((line) => line.trim().startsWith(`aieng ${words.join(" ")}`));
    const generic = (words[0] === "command" || words[0] === "read") && operationNames.has(words[1] ?? "");
    const topic = words[0] === "guide" && words.length === 2;
    return !inUsage && !generic && !topic;
  });
  return [...names, ...commands.map((words) => `aieng ${words.join(" ")}`)];
}

// ------------------------------------------------------------------ tools/list
function toolsCheck(): void {
  const undescribed = listedTools.filter((listed) => !listed.description?.trim()).map((listed) => listed.name);
  const untyped = listedTools.flatMap(untypedArguments);
  record(
    questions.tools,
    "mcp",
    undescribed.length === 0 && untyped.length === 0,
    `${listedTools.length} tools; ${undescribed.length} with no description; untyped object arguments: ${untyped.join(", ") || "none"}`,
    "0 undescribed, 0 untyped",
    toolsTokens,
  );
}

// ------------------------------------------------------------------ where do I start
function startCheck(path: Path, text: string, problem: string): void {
  const tokens = estimateTokens(text);
  const unknown = unknownReferences(text);
  const startPage = text.startsWith("# AI Engineer: start here");
  record(
    questions.start,
    path,
    !problem && startPage && tokens <= guideTokenBudgets.index && unknown.length === 0,
    problem || `start page of ${tokens} tokens; names that do not exist: ${unknown.join(", ") || "none"}`,
    `one start page under ${guideTokenBudgets.index} tokens that names only existing tools, operations and commands`,
    tokens,
  );
}

async function startChecks(): Promise<void> {
  const byTool = await tool("aieng_guide", {});
  const byHttp = await http("GET", "/v1/guide");
  const byCli = (await run(process.execPath, [cli, "guide"], { env: cliEnvironment })).stdout.trimEnd();
  startCheck("mcp", byTool.text, toolProblem("aieng_guide") || (byTool.error ? failure(byTool) : ""));
  startCheck("http", String(object(byHttp.value).text ?? ""), byHttp.error ? failure(byHttp) : "");
  const same = byCli === byTool.text;
  record(
    questions.start,
    "cli",
    same,
    same ? "aieng guide prints the same page as the MCP tool" : "aieng guide differs from the MCP tool",
    "the same start page on every transport",
    estimateTokens(byCli),
  );
}

// ------------------------------------------------------------------ knowledge answers (need the database)
const query = options.query ?? "agent";
const hitFields = ["ref", "kind", "title", "snippet", "score", "evidence", "read_more"];
const claimFields = ["statement", "status", "verified", "verdicts", "probes", "restatements", "conflicts"];
const sourceFields = ["source", "assessments", "track_record"];
const dueFields = ["attention", "probe_revalidation", "releases_needing_review", "counts"];

function searchCheck(path: Path, answer: Answer, problem: string): void {
  const hits = rows(object(answer.value).hits);
  const tokens = estimateTokens(answer.text);
  const complete = hits.every((hit) => hitFields.every((field) => field in hit));
  const judged = hits.filter((hit) => hit.evidence !== null).length;
  const observed = answer.error
    ? failure(answer)
    : `query "${query}": ${hits.length} hits, ${judged} with an evidence signal, compact fields complete: ${complete}`;
  record(
    questions.find,
    path,
    !problem && !answer.error && hits.length > 0 && complete && tokens <= budgets.search,
    problem || observed,
    `at least one compact hit (${hitFields.join(", ")}) under ${budgets.search} tokens`,
    tokens,
  );
}

function recordCheck(question: string, path: Path, answer: Answer, fields: readonly string[], problem: string): void {
  const value = object(answer.value);
  const missing = fields.filter((field) => !(field in value));
  const tokens = estimateTokens(answer.text);
  const observed = answer.error
    ? failure(answer)
    : missing.length === 0
      ? "all fields present"
      : `missing ${missing.join(", ")}`;
  record(
    question,
    path,
    !problem && !answer.error && missing.length === 0 && tokens <= budgets.record,
    problem || observed,
    `${fields.join(", ")} under ${budgets.record} tokens`,
    tokens,
  );
}

/** Without a database the knowledge answers are not run; the tools must still be listed, described and typed. */
function knowledgeNotRun(): void {
  const tools = [
    [questions.find, "search_knowledge"],
    [questions.claim, "inspect_knowledge"],
    [questions.source, "inspect_knowledge"],
    [questions.due, "inspect_knowledge"],
  ] as const;
  for (const [question, name] of tools) {
    const problem = toolProblem(name);
    const listed = `not run without a database; tool ${name} is listed, described and typed`;
    record(question, "mcp", problem ? false : "not_run", problem || listed, "an answer from the knowledge base");
    record(question, "http", "not_run", "not run without a database", "an answer from the knowledge base");
  }
}

async function knowledgeChecks(): Promise<void> {
  searchCheck("mcp", await tool("search_knowledge", { query, limit: 5 }), toolProblem("search_knowledge"));
  searchCheck("http", await read("search_knowledge", { query, limit: 5 }), "");

  // One claim to read: the one named on the command line, else the first claim the evidence lens returns.
  const judged = await read("search_knowledge", { query, lenses: ["evidence"], kinds: ["claim"], limit: 5 });
  const firstClaim = rows(object(judged.value).hits).find((hit) => String(hit.ref).startsWith("claim:"));
  const claimId = options.claim ?? (firstClaim ? String(firstClaim.ref).slice("claim:".length) : undefined);
  const noClaim = claimId ? "" : `no claim to read: the evidence lens returned none for "${query}" (pass --claim <id>)`;
  const claimByTool = claimId ? await tool("inspect_knowledge", { what: "claim", id: claimId }) : noAnswer;
  const claimByHttp = claimId ? await read("get_claim", { claim_id: claimId }) : noAnswer;
  recordCheck(questions.claim, "mcp", claimByTool, claimFields, toolProblem("inspect_knowledge") || noClaim);
  recordCheck(questions.claim, "http", claimByHttp, claimFields, noClaim);

  // One source to read: the one named on the command line, else whoever stated that claim.
  const claim = object(claimByHttp.value);
  const statedBy = String(claim.stated_by ?? claim.channel ?? "")
    .split(";")[0]
    ?.trim();
  const name = options.source ?? (statedBy || undefined);
  const noSource = name ? "" : "no source to read: get_claim returned no stated_by or channel (pass --source <name>)";
  const sourceByTool = name ? await tool("inspect_knowledge", { what: "source", name }) : noAnswer;
  const sourceByHttp = name ? await read("get_source", { name }) : noAnswer;
  recordCheck(questions.source, "mcp", sourceByTool, sourceFields, toolProblem("inspect_knowledge") || noSource);
  recordCheck(questions.source, "http", sourceByHttp, sourceFields, noSource);

  const dueByTool = await tool("inspect_knowledge", { what: "due" });
  recordCheck(questions.due, "mcp", dueByTool, dueFields, toolProblem("inspect_knowledge"));
  recordCheck(questions.due, "http", await read("list_due", {}), dueFields, "");
}

// ------------------------------------------------------------------ schema navigation (files, no database)
const schemaQuery = "verified claims";
const schemaTarget = "api.verified_claims";

async function schemaCheck(
  path: Path,
  search: Answer,
  readPage: (page: string) => Promise<Answer>,
  problem: string,
): Promise<void> {
  const body = object(search.value);
  const results = rows(body.results);
  const head = String(object(body.head).migration_head ?? "");
  const hit = results.find((result) => result.name === schemaTarget);
  const searchTokens = estimateTokens(search.text);
  const wanted = `${schemaTarget} found and read in two answers, each carrying the workspace head`;
  if (problem || search.error || !hit || !head) {
    const missing = hit ? "no workspace head in the answer" : `"${schemaQuery}" did not find ${schemaTarget}`;
    record(questions.schema, path, false, problem || (search.error ? failure(search) : missing), wanted, searchTokens);
    return;
  }
  const page = await readPage(String(hit.path));
  const pageTokens = estimateTokens(page.text);
  const readable = !page.error && page.text.includes("## Columns") && page.text.includes(head);
  const observed =
    `search (${searchTokens} tokens) found ${hit.path} among ${results.length} results at head ${head}; ` +
    `page (${pageTokens} tokens) ${readable ? "read with the head" : "not readable"}`;
  record(
    questions.schema,
    path,
    readable && searchTokens <= budgets.schemaSearch && pageTokens <= budgets.schemaPage,
    page.error ? failure(page) : observed,
    wanted,
    searchTokens + pageTokens,
  );
}

async function schemaChecks(): Promise<void> {
  await schemaCheck(
    "mcp",
    await tool("schema_search", { query: schemaQuery }),
    (page) => tool("schema_get", { page }),
    toolProblem("schema_search", "schema_get"),
  );
  await schemaCheck(
    "http",
    await http("GET", `/v1/schema/search?query=${encodeURIComponent(schemaQuery)}`),
    (page) => http("GET", `/v1/schema/pages/${page}`),
    "",
  );
}

// ------------------------------------------------------------------ authoring (guide and describe; nothing is written)
const authoringWords = ["course", "module", "lesson", "activity", "artifact", "parts", "claim"];
const authoringOperations = [
  "create_work",
  "revise_work",
  "preview_exposure",
  "review_revision",
  "freeze_release",
  "offer_release",
];
const authoringKinds = ["course", "module", "lesson", "activity"];

function authoringCheck(path: Path, guide: string, described: Answer, problem: string): void {
  const tokens = estimateTokens(guide);
  const named = new Set(scanGuideReferences(guide).names);
  const missing = [
    ...authoringWords.filter((word) => !guide.includes(word)),
    ...authoringOperations.filter((operation) => !named.has(operation) || !operationNames.has(operation)),
  ];
  const unknown = unknownReferences(guide);
  const description = object(described.value);
  const kinds = object(object(object(description.input).properties).kind).enum;
  const typed = Array.isArray(kinds) && authoringKinds.every((kind) => kinds.includes(kind));
  const example = Boolean(object(description.example).payload) && Boolean(description.output);
  record(
    questions.author,
    path,
    !problem && missing.length === 0 && unknown.length === 0 && typed && example && tokens <= guideTokenBudgets.topic,
    problem ||
      `authoring guide of ${tokens} tokens; missing: ${missing.join(", ") || "none"}; names that do not exist: ` +
        `${unknown.join(", ") || "none"}; create_work has typed kinds: ${typed}, output and example: ${example}`,
    `a how-to under ${guideTokenBudgets.topic} tokens naming existing operations, and create_work's typed input, output and example`,
    tokens + estimateTokens(described.text),
  );
}

async function authoringChecks(): Promise<void> {
  const guideByTool = await tool("aieng_guide", { topic: "authoring" });
  const guideByHttp = await http("GET", "/v1/guide/authoring");
  authoringCheck(
    "mcp",
    guideByTool.text,
    await tool("aieng_describe", { ref: "create_work" }),
    toolProblem("aieng_guide", "aieng_describe", "publish_built_site"),
  );
  authoringCheck(
    "http",
    String(object(guideByHttp.value).text ?? ""),
    await http("GET", "/v1/operations/create_work"),
    "",
  );
}

// ------------------------------------------------------------------ run, then the scorecard
toolsCheck();
await startChecks();
if (options.withoutDatabase) knowledgeNotRun();
else await knowledgeChecks();
await schemaChecks();
await authoringChecks();
await mcp.close();
await mcpHost.close();
await api.close();

const count = (result: Result) => checks.filter((check) => check.result === result).length;
const marks: Readonly<Record<Result, string>> = { pass: "pass", fail: "FAIL", not_run: "not run" };
const mode = options.withoutDatabase ? "without a database" : "live database";
const summary =
  `Consumer surface: ${count("pass")} of ${checks.length} checks pass, ${count("fail")} fail, ${count("not_run")} not run ` +
  `(${mode}; ${listedTools.length} tools, tools/list ~${toolsTokens} tokens; ${operationNames.size} operations)`;
const lines = checks.map((check) => {
  const observed = check.observed.replace(/\|/g, "/");
  return `| ${marks[check.result]} | ${check.path} | ${check.question} | ${observed} | ${check.tokens ?? ""} |`;
});
const header = ["| Result | Path | Question | Observed | Tokens |", "| --- | --- | --- | --- | --- |"];
process.stdout.write(`${[summary, "", ...header, ...lines].join("\n")}\n`);

const scorecard = {
  ranAt: new Date().toISOString(),
  mode: options.withoutDatabase ? "without_database" : "live",
  tools: { count: listedTools.length, tokens: toolsTokens, names: [...toolNames] },
  operations: operationNames.size,
  passed: count("pass"),
  failed: count("fail"),
  notRun: count("not_run"),
  checks,
};
await mkdir(new URL("lab-results/", repository), { recursive: true });
await writeFile(new URL("lab-results/consumer-surface.json", repository), `${JSON.stringify(scorecard, null, 2)}\n`);
process.exitCode = options.strict && count("fail") > 0 ? 1 : 0;
