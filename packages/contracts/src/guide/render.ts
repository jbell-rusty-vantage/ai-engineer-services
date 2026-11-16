import { ProductError } from "../errors.js";
import { operationCatalog, publicOperations } from "../operations.js";
import {
  commandUsage,
  type GuideTopic,
  guideTopics,
  type SurfaceJob,
  surfaceCommands,
  surfaceJobs,
} from "../surface.js";
import { operationTopics } from "./operation-topics.js";
import { indexIntroduction, indexRules, topicBodies, topicTitles } from "./pages.js";

export const guideIndexTopic = "index";

/** Size targets, in estimated tokens, so the guide stays cheap to read. */
export const guideTokenBudgets = { index: 500, topic: 1200 } as const;

export interface GuidePage {
  readonly topic: string;
  readonly title: string;
  /** Markdown, exactly as every surface returns it. */
  readonly text: string;
  readonly topics: readonly string[];
}

/** The estimate every surface reports: four characters per token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const code = (value: string) => `\`${value}\``;

function isGuideTopic(value: string): value is GuideTopic {
  return (guideTopics as readonly string[]).includes(value);
}

/** The command line the index names for a job: the generic one for its operation, else its friendly command. */
function commandForJob(job: SurfaceJob): string | undefined {
  const operation = job.operation ? operationCatalog.get(job.operation) : undefined;
  if (operation) return `aieng ${operation.kind} ${operation.name}`;
  const command = surfaceCommands.find((candidate) => (candidate.jobs as readonly string[]).includes(job.id));
  if (!command) return undefined;
  const firstArgument = command.arguments.split(" ")[0] ?? "";
  return ["aieng", ...command.path, firstArgument.startsWith("<") ? firstArgument : ""].filter(Boolean).join(" ");
}

function jobLine(job: SurfaceJob): string {
  const command = commandForJob(job);
  const ways = [job.tools.map(code).join(", "), command ? code(command) : ""].filter(Boolean).join(" · ");
  return `- ${job.label}: ${ways}`;
}

function renderIndex(): string {
  return [
    "# AI Engineer: start here",
    "",
    indexIntroduction,
    "",
    "## Jobs (MCP tools · CLI)",
    ...surfaceJobs.map(jobLine),
    "",
    "## Go deeper",
    `- ${code("aieng_guide {topic}")} (${code("aieng guide <topic>")}, ${code("GET /v1/guide/<topic>")}): ${guideTopics.join(", ")}.`,
    `- ${code("aieng_describe {ref}")} (${code("aieng describe <operation>")}, ${code("GET /v1/operations/<operation>")}): input, output and an example for any of the ${publicOperations().length} operations (${code("aieng operations")}).`,
    "",
    "## Rules",
    ...indexRules.map((rule) => `- ${rule}`),
  ].join("\n");
}

function referenceSection(topic: GuideTopic): string[] {
  const jobs: readonly SurfaceJob[] = surfaceJobs.filter((job) => job.topic === topic);
  const jobIds = jobs.map((job) => job.id);
  const tools = [...new Set(jobs.flatMap((job) => job.tools))].map(code);
  const commands = surfaceCommands
    .filter((command) => command.jobs.some((job) => jobIds.includes(job)))
    .map((command) => code(commandUsage(command)));
  const operations = operationTopics[topic];
  const lines = ["## Reference"];
  if (tools.length > 0) lines.push(`- MCP tools: ${tools.join(", ")}`);
  if (commands.length > 0) lines.push(`- CLI: ${commands.join("; ")}`);
  if (operations.length > 0) {
    lines.push(
      `- Operations (${code("aieng read <operation>")} or ${code("aieng command <operation>")}; shapes with ${code("aieng_describe")}): ${operations.join(", ")}`,
    );
  }
  return lines;
}

function renderTopic(topic: GuideTopic): string {
  return [`# ${topicTitles[topic]}`, "", topicBodies[topic](), "", ...referenceSection(topic)].join("\n");
}

/** Renders the start page (no topic, or `index`) or one topic. Lists come from the catalogs at call time. */
export function renderGuide(topic?: string): GuidePage {
  const name = topic?.trim().toLowerCase() || guideIndexTopic;
  if (name === guideIndexTopic) {
    return { topic: guideIndexTopic, title: "AI Engineer: start here", text: renderIndex(), topics: guideTopics };
  }
  if (!isGuideTopic(name))
    throw new ProductError("NOT_FOUND", `guide topic ${name}; topics: ${guideTopics.join(", ")}`);
  return { topic: name, title: topicTitles[name], text: renderTopic(name), topics: guideTopics };
}
