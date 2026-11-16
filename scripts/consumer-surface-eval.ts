/**
 * Consumer-surface evaluation: can an agent answer the owner's questions from this service?
 *
 * It asks the questions an agent comes with through the consumer paths:
 *   - `mcp`:  an agent with no compute environment, which has the remote MCP server and nothing else;
 *   - `http`: a sandboxed agent, whose `aieng` CLI is a thin client over these same routes;
 *   - `cli`:  the `aieng` command itself, for the start page and the usage text.
 * For each question it checks that the tool exists, has a description and a typed input, and returns a non-empty,
 * small answer (the token estimate is reported), and that the guide names only tools, operations and commands that
 * exist. Every check is deterministic: no model call, nothing paid. All but one are read-only.
 *
 * The authoring flow writes: "create a module with two lessons and an activity, bind a section to a verified claim,
 * read it back and hand it for review", through the MCP path and the HTTP path. It runs only against the loopback lab
 * stack, as a lab user created for it, in that user's personal workspace and in one new shared workspace. It removes
 * nothing; it revokes the two client grants it mints. Without a database, or against any other database, it is
 * reported as not run.
 *
 * The API and the remote MCP server are built in process on loopback ports, the way `scripts/lab/prove-surfaces.ts`
 * builds the remote MCP host. Run `pnpm build` first (the CLI is run from `apps/cli/dist`).
 *
 *   pnpm eval:consumer-surface                      database from AIENG_DB_* (the lab stack), session from AIENG_ACCESS_TOKEN
 *   pnpm eval:consumer-surface --without-database   knowledge answers are reported as not run; everything else runs
 *
 * Options: --query <keywords> (default "agent"), --claim <claim-id>, --source <name>, --entity <entity-id>,
 * --fact-query <keywords> (default "price"), --strict (exit 1 on a failure).
 * Without AIENG_ACCESS_TOKEN a lab user is created for the read checks, and only when AIENG_DB_URL is a loopback lab
 * stack. Credentials are never printed. The result is a scorecard, not a
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
    entity: { type: "string" },
    "fact-query": { type: "string" },
  },
});

const options = { ...values, withoutDatabase: values["without-database"] === true };

const questions = {
  tools: "Is every tool self-explanatory?",
  start: "Where do I start, and which tool do I use for which job?",
  find: "How do I find what the knowledge base already knows about a topic, and how well it is supported?",
  claim: "How do I read one verified claim with its evidence and verdicts?",
  entity: "How do I read one entity, where its facts come from and what changed for it?",
  source: "How do I read one source and its track record?",
  due: "What is stale or due for review?",
  schema: "How do I navigate the schema to find where something lives?",
  author: "How do I create a course, a module, a lesson, an activity or an artifact, and release it?",
  method: "Where is the method for authoring and for the knowledge base, when I have no files?",
  restate: "Can a statement in a lesson name the shared claim it restates?",
  authorFlow:
    "How do I create a course module with two lessons and an activity, bind a section to a verified claim, read it back and hand it for review?",
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
  const database: DatabaseGateway = { command: refuse, read: refuse, scope: refuse, worker: refuse };
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

async function tool(name: string, args: Record<string, unknown>, client: Client = mcp): Promise<Answer> {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: { text: string }[];
  };
  const text = result.content[0]?.text ?? "";
  const value = parsed(text);
  return { value, text, ...(result.isError ? { error: errorOf(value) } : {}) };
}

async function http(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  caller: Record<string, string> = authorization,
): Promise<Answer> {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: { ...caller, ...(body === undefined ? {} : { "content-type": "application/json" }) },
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
const cardFields = ["entity", "facts", "relationships", "events", "sources", "truncated"];
const factFields = ["entity_id", "stream_kind", "facts", "count", "truncated"];
const changeFields = ["after_seq", "through_seq", "changes", "counts", "truncated"];
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

function recordCheck(
  question: string,
  path: Path,
  answer: Answer,
  fields: readonly string[],
  problem: string,
  summary = "all fields present",
): void {
  const value = object(answer.value);
  const missing = fields.filter((field) => !(field in value));
  const tokens = estimateTokens(answer.text);
  const observed = answer.error ? failure(answer) : missing.length === 0 ? summary : `missing ${missing.join(", ")}`;
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
    [questions.entity, "inspect_knowledge"],
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

/** What a verified claim's answer holds, and why it does not read as one (empty when it does). */
function verifiedClaim(answer: Answer): { readonly summary: string; readonly problem: string } {
  const claim = object(answer.value);
  const verdicts = rows(claim.verdicts);
  const cells = rows(claim.probes).flatMap((probe) => rows(probe.cells));
  const located = cells.filter((cell) => cell.locator_id).length;
  const summary = `status ${String(claim.status)}; ${verdicts.length} verdicts; ${cells.length} probe cells, ${located} with an evidence locator`;
  if (answer.error) return { summary, problem: "" };
  if (claim.status !== "verified" || !object(claim.verified).receipt_id)
    return { summary, problem: `${summary}: not a verified claim with its admission` };
  if (verdicts.length === 0 || located === 0) return { summary, problem: `${summary}: no verdict or no evidence` };
  return { summary, problem: "" };
}

/** Who stated a claim: its own attribution, else the attribution of the claim it restates. */
async function sourceNameOf(claim: Record<string, unknown>): Promise<string | undefined> {
  const named = (value: Record<string, unknown>) =>
    String(value.stated_by ?? value.channel ?? "")
      .split(";")[0]
      ?.trim() || undefined;
  const original = object(object(claim.restatements).restates).claim_id;
  if (named(claim) || typeof original !== "string") return named(claim);
  return named(object((await read("get_claim", { claim_id: original })).value));
}

const factQuery = options["fact-query"] ?? "price";

/** One entity to read: the one named on the command line, else the first entity card for the fact query that lists a current fact. */
async function entityWithFacts(): Promise<string | undefined> {
  if (options.entity) return options.entity;
  const cards = await read("search_knowledge", { query: factQuery, kinds: ["profile"], limit: 5 });
  for (const hit of rows(object(cards.value).hits)) {
    if (typeof hit.entity_id !== "string") continue;
    const card = object((await read("get_entity", { entity_id: hit.entity_id })).value);
    if (rows(card.facts).length > 0) return hit.entity_id;
  }
  return undefined;
}

interface EntityReads {
  card(entityId: string): Promise<Answer>;
  facts(entityId: string, streamKind: string): Promise<Answer>;
  changes(entityId: string): Promise<Answer>;
}

/** The card, the evidence behind the first kind of fact on it, and what changed for the entity. */
async function entityCheck(
  path: Path,
  entityId: string | undefined,
  reads: EntityReads,
  problem: string,
): Promise<void> {
  const wanted =
    `a card (${cardFields.join(", ")}), the claim, locator and capture behind one kind of its facts, and its changes ` +
    `up to a knowledge sequence, each under ${budgets.record} tokens`;
  if (problem || !entityId) {
    const none = `no entity with a current fact among the entity cards for "${factQuery}" (pass --entity <id>)`;
    record(questions.entity, path, false, problem || none, wanted, 0);
    return;
  }
  const card = await reads.card(entityId);
  const cardFacts = rows(object(card.value).facts);
  const streamKind = String(cardFacts[0]?.stream_kind ?? "");
  const facts = streamKind ? await reads.facts(entityId, streamKind) : noAnswer;
  const changes = await reads.changes(entityId);
  const answers = [card, facts, changes];
  const failed = answers.find((answer) => answer.error);
  const missing = [
    ...cardFields.filter((field) => !(field in object(card.value))),
    ...factFields.filter((field) => !(field in object(facts.value))),
    ...changeFields.filter((field) => !(field in object(changes.value))),
  ];
  const evidence = rows(object(facts.value).facts);
  const located = evidence.filter((fact) => fact.claim && fact.locator && fact.capture).length;
  const reached = Number(object(changes.value).through_seq ?? 0);
  const sizes = answers.map((answer) => estimateTokens(answer.text));
  const observed = failed
    ? failure(failed)
    : missing.length > 0
      ? `missing ${missing.join(", ")}`
      : `${String(object(object(card.value).entity).kind)} card with ${cardFacts.length} facts; ${streamKind}: ` +
        `${evidence.length} of ${String(object(facts.value).count)} facts shown, ${located} with claim, locator and capture; ` +
        `${rows(object(changes.value).changes).length} changes shown up to sequence ${reached}`;
  record(
    questions.entity,
    path,
    !failed && missing.length === 0 && located > 0 && reached > 0 && sizes.every((size) => size <= budgets.record),
    observed,
    wanted,
    sizes.reduce((total, size) => total + size, 0),
  );
}

async function knowledgeChecks(): Promise<void> {
  searchCheck("mcp", await tool("search_knowledge", { query, limit: 5 }), toolProblem("search_knowledge"));
  searchCheck("http", await read("search_knowledge", { query, limit: 5 }), "");

  // One verified claim to read: the one named on the command line, else the first verified assertion (tier 0) the
  // evidence lens returns.
  const verified = { query, lenses: ["evidence"], tiers: [0], kinds: ["claim"], limit: 5 };
  const judged = await read("search_knowledge", verified);
  const firstClaim = rows(object(judged.value).hits).find((hit) => String(hit.ref).startsWith("claim:"));
  const claimId = options.claim ?? (firstClaim ? String(firstClaim.ref).slice("claim:".length) : undefined);
  const noClaim = claimId
    ? ""
    : `no claim to read: the evidence lens returned no verified assertion for "${query}" (pass --claim <id>)`;
  const claimByTool = claimId ? await tool("inspect_knowledge", { what: "claim", id: claimId }) : noAnswer;
  const claimByHttp = claimId ? await read("get_claim", { claim_id: claimId }) : noAnswer;
  const byTool = verifiedClaim(claimByTool);
  const byHttp = verifiedClaim(claimByHttp);
  recordCheck(
    questions.claim,
    "mcp",
    claimByTool,
    claimFields,
    toolProblem("inspect_knowledge") || noClaim || byTool.problem,
    byTool.summary,
  );
  recordCheck(questions.claim, "http", claimByHttp, claimFields, noClaim || byHttp.problem, byHttp.summary);

  const entityId = await entityWithFacts();
  await entityCheck(
    "mcp",
    entityId,
    {
      card: (id) => tool("inspect_knowledge", { what: "entity", id }),
      facts: (id, stream_kind) => tool("inspect_knowledge", { what: "fact_evidence", id, stream_kind }),
      changes: (id) => tool("inspect_knowledge", { what: "entity_changes", id }),
    },
    toolProblem("inspect_knowledge"),
  );
  await entityCheck(
    "http",
    entityId,
    {
      card: (entity_id) => read("get_entity", { entity_id }),
      facts: (entity_id, stream_kind) => read("get_fact_evidence", { entity_id, stream_kind }),
      changes: (entity_id) => read("list_entity_changes", { entity_id }),
    },
    "",
  );

  // One source to read: the one named on the command line, else whoever stated that claim (or the claim it restates).
  const name = options.source ?? (await sourceNameOf(object(claimByHttp.value)));
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

// ------------------------------------------------------------------ the method skills (guide topics; no database)
const methodTopics = [
  "content-authoring",
  "content-authoring/references/lesson-craft",
  "ai-engineer-knowledge-charter",
];

async function methodChecks(): Promise<void> {
  const index = (await tool("aieng_guide", {})).text;
  const wanted =
    `the start page lists the skills, and each skill page is the same text on every transport, under ` +
    `${guideTokenBudgets.skill} tokens, naming only existing tools, operations and commands`;
  const pages = await Promise.all(
    methodTopics.map(async (topic) => ({
      topic,
      byTool: await tool("aieng_guide", { topic }),
      byHttp: await http("GET", `/v1/guide/${topic}`),
      byCli: (await run(process.execPath, [cli, "guide", topic], { env: cliEnvironment })).stdout.trimEnd(),
    })),
  );
  const paths: Record<Path, (page: (typeof pages)[number]) => string> = {
    mcp: (page) => page.byTool.text,
    http: (page) => String(object(page.byHttp.value).text ?? ""),
    cli: (page) => page.byCli,
  };
  for (const path of ["mcp", "http", "cli"] as const) {
    const problems = pages.flatMap((page) => {
      const text = paths[path](page);
      const unknown = unknownReferences(text);
      return [
        ...(text && text === page.byTool.text ? [] : [`${page.topic} is missing or differs from the MCP answer`]),
        ...(estimateTokens(text) <= guideTokenBudgets.skill ? [] : [`${page.topic} is over the budget`]),
        ...(unknown.length === 0 ? [] : [`${page.topic} names ${unknown.join(", ")}`]),
      ];
    });
    const unlisted = methodTopics.filter((topic) => !index.includes(topic));
    const tokens = pages.reduce((total, page) => total + estimateTokens(paths[path](page)), 0);
    record(
      questions.method,
      path,
      problems.length === 0 && unlisted.length === 0,
      problems.join("; ") ||
        (unlisted.length > 0
          ? `the start page does not list ${unlisted.join(", ")}`
          : `${pages.length} skill pages served (${methodTopics.join(", ")}), all listed on the start page`),
      wanted,
      tokens,
    );
  }
}

// ------------------------------------------------------------------ the authoring flow (writes; loopback lab only)
// A fresh lab user authors in workspaces nobody else has: its personal workspace through the MCP path, a new shared
// workspace through the HTTP path. Each path acts as an agent, with a client grant minted for it and revoked at the
// end. Nothing else is changed or removed.
const flowTools = ["draft_work", "inspect_authoring", "request_review", "read_lesson"] as const;
const flowWanted =
  "a module placing two lessons and an activity, one lesson section bound to a verified claim, all read back, a " +
  "hand-over note left for the reviewer, and the agent's own release review refused";
const evidenceRule = {
  schema: "aieng.evidence-rule.v2",
  observables: ["both outputs", "explanation"],
  facet: "independent",
};

interface FlowCaller {
  /** Saves a work with its structure and returns `{ workId, revisionId }`. */
  draft(workspaceId: string, kind: string, title: string, revision: Record<string, unknown>): Promise<Answer>;
  works(workspaceId: string): Promise<Answer>;
  /** One revision with its blocks and statements. */
  revision(revisionId: string): Promise<Answer>;
  render(revisionId: string): Promise<Answer>;
  exposure(workspaceId: string, revisionId: string): Promise<Answer>;
  /** Leaves the hand-over note; the answer holds the thread id under `thread_id` or `threadId`. */
  handOver(workspaceId: string, revisionId: string, note: string): Promise<Answer>;
  thread(workspaceId: string, threadId: string): Promise<Answer>;
}

interface VerifiedClaim {
  readonly id: string;
  readonly statement: string;
}

class FlowStop extends Error {}

function answered(answer: Answer, step: string): Record<string, unknown> {
  if (answer.error) throw new FlowStop(`${step}: ${failure(answer)}`);
  return object(answer.value);
}

/** The first verified claim the evidence lens returns for the evaluation's query, read as the author. */
async function verifiedClaimFor(headers: Record<string, string>): Promise<VerifiedClaim | undefined> {
  const judged = await http(
    "POST",
    "/v1/reads/search_knowledge",
    { payload: { query, lenses: ["evidence"], tiers: [0], kinds: ["claim"], limit: 5 } },
    headers,
  );
  const hit = rows(object(judged.value).hits).find((candidate) => String(candidate.ref).startsWith("claim:"));
  const id = options.claim ?? (hit ? String(hit.ref).slice("claim:".length) : undefined);
  if (!id) return undefined;
  const claim = object((await http("POST", "/v1/reads/get_claim", { payload: { claim_id: id } }, headers)).value);
  return claim.status === "verified" ? { id, statement: String(claim.statement) } : undefined;
}

/** The module of the question: two lessons and an activity, the first lesson's section bound to the claim. */
async function authorModule(caller: FlowCaller, workspaceId: string, claim: VerifiedClaim, label: string) {
  const sizes: number[] = [];
  const step = async (name: string, answer: Promise<Answer>) => {
    const resolved = await answer;
    sizes.push(estimateTokens(resolved.text));
    return answered(resolved, name);
  };
  const section = crypto.randomUUID();
  const text = (markdown: string) => ({ key: crypto.randomUUID(), type: "text", content: { markdown } });
  const lessonOne = await step(
    "draft the lesson with the bound section",
    caller.draft(workspaceId, "lesson", `Read the claim (${label})`, {
      body: {
        formatVersion: 2,
        blocks: [
          {
            key: section,
            type: "section",
            content: { title: "What is verified" },
            bindings: ["claim-1"],
            children: [text(claim.statement)],
          },
        ],
      },
      bindings: [
        { local_key: "claim-1", relation: "supports", target: { kind: "claim", id: claim.id }, block_key: section },
      ],
      assertions: [
        {
          kind: "claim",
          statement: claim.statement,
          support_status: "supported",
          block_key: section,
        },
      ],
    }),
  );
  const lessonTwo = await step(
    "draft the second lesson",
    caller.draft(workspaceId, "lesson", `Apply it (${label})`, {
      body: { formatVersion: 2, blocks: [text("Worked example.")] },
    }),
  );
  const activity = await step(
    "draft the activity",
    caller.draft(workspaceId, "activity", `Show it (${label})`, {
      body: { formatVersion: 2, blocks: [text("Do the changed case alone and paste both outputs.")] },
    }),
  );
  const children = [lessonOne, lessonTwo, activity].map((work) => String(work.revisionId));
  const occurrences = children.map(() => crypto.randomUUID());
  const outcome = crypto.randomUUID();
  const module = await step(
    "draft the module with its parts, outcome and requirement",
    caller.draft(workspaceId, "module", `Consumer evaluation module (${label})`, {
      body: { formatVersion: 2, blocks: [text("Two lessons and the activity that proves the outcome.")] },
      parts: children.map((child, ordinal) => ({
        occurrence_key: occurrences[ordinal],
        child_revision_id: child,
        ordinal,
      })),
      outcomes: [
        {
          outcome_key: outcome,
          statement: "Explains what the claim rests on",
          bloom_level: "apply",
          evidence_rule: evidenceRule,
        },
      ],
      requirements: [
        {
          requirement_key: crypto.randomUUID(),
          kind: "mandatory_activity",
          occurrence_key: occurrences[2],
          rationale: "The activity proves the outcome",
          options: [
            {
              route: "standard",
              activity_revision_id: children[2],
              evidence_rule: evidenceRule,
              approval_state: "proposed",
            },
          ],
        },
      ],
      runtime: [{ local_key: "python", kind: "language_runtime", name: "python", version_spec: ">=3.12" }],
    }),
  );
  const moduleRevision = String(module.revisionId);

  // Read it back: the work list, the bound lesson, the module as a rendered page, and what a release would carry.
  const listed = await caller.works(workspaceId);
  sizes.push(estimateTokens(listed.text));
  if (listed.error) throw new FlowStop(`list the works: ${failure(listed)}`);
  const works = rows(Array.isArray(listed.value) ? listed.value : object(listed.value).works);
  const lesson = await step("read the lesson back", caller.revision(children[0] ?? ""));
  const rendered = await step("render the module", caller.render(moduleRevision));
  const exposure = await step("preview the exposure", caller.exposure(workspaceId, moduleRevision));
  const items = rows(exposure.items);
  const revisions = items.filter((item) => item.kind === "revision").map((item) => String(item.id));
  const statements = rows(lesson.statements ?? lesson.assertions);
  const sectionBlock = rows(object(lesson.body).blocks).find((block) => block.key === section);
  const problems = [
    ...(works.some((work) => work.id === module.workId && work.head === moduleRevision)
      ? []
      : ["the module is not listed with its head"]),
    ...([moduleRevision, ...children].every((revision) => revisions.includes(revision))
      ? []
      : ["the exposure does not carry the module and its three parts"]),
    ...(items.some((item) => item.kind === "claim" && item.id === claim.id)
      ? []
      : ["the exposure does not carry the bound claim"]),
    ...(Array.isArray(sectionBlock?.bindings) && sectionBlock.bindings.includes("claim-1")
      ? []
      : ["the section does not list its claim binding"]),
    ...(statements.some((statement) => statement.blockKey === section)
      ? []
      : ["no statement is anchored to the section"]),
    ...(rendered.title && Array.isArray(rendered.blocks) ? [] : ["the module was not rendered"]),
  ];
  if (problems.length > 0) throw new FlowStop(problems.join("; "));

  // Hand it over, and read the note where the reviewer reads it.
  const note = `Submitted for review: module ${moduleRevision}, placing ${children.join(", ")}. Evidence: claim ${claim.id}.`;
  const handed = await step("hand over", caller.handOver(workspaceId, moduleRevision, note));
  const threadId = String(handed.thread_id ?? handed.threadId);
  const thread = await step("read the hand-over", caller.thread(workspaceId, threadId));
  if (!JSON.stringify(thread.messages ?? []).includes("Submitted for review"))
    throw new FlowStop("the hand-over note is not in the thread");

  // A separate question, asked last so it cannot stop the flow: may a statement name the shared claim it restates?
  const restating = crypto.randomUUID();
  const restated = await caller.draft(workspaceId, "lesson", `Restate the claim (${label})`, {
    body: { formatVersion: 2, blocks: [{ key: restating, type: "text", content: { markdown: claim.statement } }] },
    assertions: [
      {
        kind: "claim",
        statement: claim.statement,
        support_status: "supported",
        block_key: restating,
        uses_claim_id: claim.id,
      },
    ],
  });
  return {
    restatement: restated.error ? failure(restated) : "",
    moduleRevision,
    workId: String(module.workId),
    closure: String(exposure.closure_sha256),
    tokens: sizes.reduce((total, size) => total + size, 0),
    summary:
      `module ${moduleRevision.slice(0, 8)} places 2 lessons and 1 activity; section bound to verified claim ` +
      `${claim.id.slice(0, 8)}; read back: ${revisions.length} revisions and the claim in the exposure, ` +
      `${statements.length} statement anchored; hand-over note in thread ${threadId.slice(0, 8)}`,
  };
}

function flowNotRun(reason: string): void {
  const problem = toolProblem(...flowTools);
  record(
    questions.authorFlow,
    "mcp",
    problem ? false : "not_run",
    problem || `${reason}; tools ${flowTools.join(", ")} are listed, described and typed`,
    flowWanted,
  );
  record(questions.authorFlow, "http", "not_run", reason, flowWanted);
  for (const path of ["mcp", "http"] as const) {
    record(questions.restate, path, "not_run", reason, "a statement linked to the shared claim it restates");
  }
}

async function authoringFlowChecks(): Promise<void> {
  if (options.withoutDatabase) return flowNotRun("not run without a database");
  const lab = readLabEnvironment();
  if (!loopbackHosts.has(new URL(lab.databaseUrl).hostname))
    return flowNotRun("not run: the flow writes, and only to the loopback lab stack");

  const author = { authorization: `Bearer ${(await createLabUser(lab, "consumer-eval-author")).accessToken}` };
  const command = (
    headers: Record<string, string>,
    operation: string,
    workspaceId: string | null,
    payload: Record<string, unknown>,
  ) =>
    http(
      "POST",
      `/v1/commands/${operation}`,
      { workspaceId, idempotencyKey: `eval-${crypto.randomUUID()}`, payload },
      headers,
    );
  const reading = (
    headers: Record<string, string>,
    operation: string,
    workspaceId: string | null,
    payload: Record<string, unknown>,
  ) => http("POST", `/v1/reads/${operation}`, { workspaceId, payload }, headers);
  const grants: string[] = [];
  /** A client grant makes the caller an agent to the database; the bare session above is the person. */
  const agentHeaders = async (clientKind: "mcp" | "harness") => {
    const grant = answered(
      await command(author, "create_client_grant", null, {
        client_kind: clientKind,
        label: `consumer-eval ${clientKind}`,
        scopes: ["read", "author", "library"],
        ttl_hours: 1,
      }),
      "mint the agent's client grant",
    );
    grants.push(String(grant.grantId));
    return { ...author, "x-aieng-client-token": String(grant.token) };
  };
  /** The service's guard: an agent client cannot record the human release review of its own module. */
  const reviewRefused = async (
    headers: Record<string, string>,
    workspaceId: string,
    flow: { workId: string; moduleRevision: string; closure: string },
  ) => {
    const review = {
      reviewType: "release_review",
      decision: "approve",
      closure_sha256: flow.closure,
      ceiling: "workspace",
    };
    const answer = await command(headers, "review_revision", workspaceId, {
      work_id: flow.workId,
      revision_id: flow.moduleRevision,
      review,
    });
    if (answer.error?.code !== "FORBIDDEN")
      throw new FlowStop(`the agent's release review was not refused: ${answer.error ? failure(answer) : "accepted"}`);
  };
  const runPath = async (
    path: Path,
    flow: () => Promise<{ summary: string; tokens: number; restatement: string }>,
    problem: string,
  ) => {
    if (problem) return record(questions.authorFlow, path, false, problem, flowWanted);
    try {
      const result = await flow();
      record(
        questions.authorFlow,
        path,
        true,
        `${result.summary}; the agent's release review refused: FORBIDDEN`,
        flowWanted,
        result.tokens,
      );
      record(
        questions.restate,
        path,
        !result.restatement,
        result.restatement
          ? `a statement naming the verified claim it restates was refused: ${result.restatement}`
          : "a statement was saved with the verified claim it restates",
        "a statement anchored to a block and linked to the shared claim it restates",
      );
    } catch (error) {
      if (!(error instanceof FlowStop)) throw error;
      record(questions.authorFlow, path, false, error.message, flowWanted);
    }
  };

  try {
    const claim = await verifiedClaimFor(author);
    const noClaim = claim ? "" : `no verified claim to bind for "${query}" (pass --claim <id>)`;

    await runPath(
      "mcp",
      async () => {
        const headers = await agentHeaders("mcp");
        const agent = new Client({ name: "consumer-surface-eval-author", version: "0.1.0" });
        await agent.connect(new StreamableHTTPClientTransport(new URL(mcpUrl), { requestInit: { headers } }));
        const call = (name: string, args: Record<string, unknown>) => tool(name, args, agent);
        try {
          const workspaceId = String(
            answered(await call("inspect_authoring", { what: "workspace" }), "find the workspace")
              .personal_workspace_id,
          );
          const flow = await authorModule(
            {
              draft: (workspace_id, kind, title, { body, assertions, ...structure }) =>
                call("draft_work", {
                  workspace_id,
                  kind,
                  title,
                  origin: "agent",
                  blocks: object(body).blocks,
                  ...(assertions ? { statements: assertions } : {}),
                  ...structure,
                }),
              works: (workspace_id) => call("inspect_authoring", { what: "works", workspace_id }),
              revision: (revisionId) => call("inspect_authoring", { what: "revision", id: revisionId }),
              render: (revision_id) => call("read_lesson", { revision_id }),
              exposure: (workspace_id, revisionId) =>
                call("inspect_authoring", { what: "exposure", workspace_id, id: revisionId }),
              handOver: (workspace_id, revision_id, note) =>
                call("request_review", { workspace_id, revision_id, note }),
              thread: (_workspaceId, threadId) => call("inspect_authoring", { what: "thread", id: threadId }),
            },
            workspaceId,
            claim as VerifiedClaim,
            "mcp",
          );
          const described = object((await call("aieng_describe", { ref: "review_revision" })).value);
          if (rows(described.tools).length > 0) throw new FlowStop("an MCP tool records reviews");
          await reviewRefused(headers, workspaceId, flow);
          return flow;
        } finally {
          await agent.close();
        }
      },
      toolProblem(...flowTools) || noClaim,
    );

    await runPath(
      "http",
      async () => {
        const headers = await agentHeaders("harness");
        const created = answered(
          await command(author, "create_workspace", null, { name: `Consumer evaluation ${new Date().toISOString()}` }),
          "create the workspace",
        );
        const workspaceId = String(created.workspaceId);
        const flow = await authorModule(
          {
            draft: (workspace, kind, title, revision) =>
              command(headers, "create_work", workspace, {
                kind,
                slug: `${kind}-${crypto.randomUUID().slice(0, 8)}`,
                revision: { title, origin: "agent", ...revision },
              }),
            works: (workspace) => reading(headers, "list_works", workspace, {}),
            revision: (revisionId) => reading(headers, "get_report", null, { revision_id: revisionId }),
            render: (revisionId) => reading(headers, "get_lesson_view", null, { revision_id: revisionId }),
            exposure: (workspace, revisionId) =>
              reading(headers, "preview_exposure", workspace, { root_revision_id: revisionId, ceiling: "workspace" }),
            handOver: async (workspace, revisionId, note) => {
              const thread = await command(headers, "create_thread", workspace, {
                title: "Review request: consumer evaluation module",
                purpose: "authoring",
                visibility: "workspace",
              });
              if (thread.error) return thread;
              const message = await command(headers, "append_message", workspace, {
                thread_id: object(thread.value).threadId,
                role: "assistant",
                content: { schema: "aieng.message.v1", parts: [{ text: note }] },
                context: {
                  schema: "aieng.context.v1",
                  items: [{ item_key: "revision", reason: "attached", revision_id: revisionId }],
                },
              });
              return message.error ? message : thread;
            },
            thread: (workspace, threadId) => reading(headers, "get_thread", workspace, { thread_id: threadId }),
          },
          workspaceId,
          claim as VerifiedClaim,
          "http",
        );
        await reviewRefused(headers, workspaceId, flow);
        return flow;
      },
      noClaim,
    );
  } finally {
    for (const grant of grants) await command(author, "revoke_client_grant", null, { grant_id: grant });
  }
}

// ------------------------------------------------------------------ run, then the scorecard
toolsCheck();
await startChecks();
if (options.withoutDatabase) knowledgeNotRun();
else await knowledgeChecks();
await schemaChecks();
await methodChecks();
await authoringChecks();
await authoringFlowChecks();
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
