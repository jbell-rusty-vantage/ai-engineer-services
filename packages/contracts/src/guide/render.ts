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
import { indexIntroduction, indexRules, topicBodies, topicMethods, topicTitles } from "./pages.js";
import { findSkillPage, methodSkills, skillTopics } from "./skill-library.js";

export const guideIndexTopic = "index";

/**
 * Size targets, in estimated tokens, so the guide stays cheap to read: the start page, an operational topic, and one
 * page of a skill (its `SKILL.md` or one reference).
 */
export const guideTokenBudgets = { index: 750, topic: 1400, skill: 2800 } as const;

export interface GuidePage {
  readonly topic: string;
  readonly title: string;
  /** Markdown, exactly as every surface returns it. */
  readonly text: string;
  /** Every topic the guide serves: the operational topics, then the skills and their references. */
  readonly topics: readonly string[];
}

/** Every topic besides the start page: the operational topics, then each skill and its references. */
export const guideTopicNames: readonly string[] = [...guideTopics, ...skillTopics];

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

/** The skills and their references, from the frontmatter of the files in `skills/`. */
function skillSection(): string[] {
  const references = methodSkills.flatMap((skill) => skill.references.map((reference) => reference.topic));
  return [
    "## Skills (the method; a skill name is a topic)",
    ...methodSkills.map((skill) => `- ${skill.name}: ${skill.description}`),
    ...(references.length > 0 ? [`- References, also topics: ${references.join(", ")}.`] : []),
  ];
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
    ...skillSection(),
    "",
    "## Go deeper",
    `- ${code("aieng_guide {topic}")} (${code("aieng guide <topic>")}, ${code("GET /v1/guide/<topic>")}): ${guideTopics.join(", ")}, or a skill or reference above.`,
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

/** Where the method behind an operational topic lives: the skill, served as a topic of its own. */
function methodLine(topic: GuideTopic): string[] {
  const method = topicMethods[topic];
  if (!method) return [];
  return [`Method: ${method.note} ${code(`aieng_guide {topic: "${method.skill}"}`)}.`, ""];
}

function renderTopic(topic: GuideTopic): string {
  return [
    `# ${topicTitles[topic]}`,
    "",
    ...methodLine(topic),
    topicBodies[topic](),
    "",
    ...referenceSection(topic),
  ].join("\n");
}

/** `Content-Authoring/references/lesson-craft.md` and `content-authoring/SKILL` name the same pages as their topics. */
function normalizeTopic(topic: string | undefined): string {
  const name = (topic ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.md$/i, "")
    .toLowerCase()
    .replace(/\/skill$/, "");
  return name || guideIndexTopic;
}

/**
 * Renders the start page (no topic, or `index`), one operational topic, or one page of a skill. Lists come from the
 * catalogs at call time; a skill page is the file's own text.
 */
export function renderGuide(topic?: string): GuidePage {
  const name = normalizeTopic(topic);
  if (name === guideIndexTopic) {
    return { topic: guideIndexTopic, title: "AI Engineer: start here", text: renderIndex(), topics: guideTopicNames };
  }
  if (isGuideTopic(name)) {
    return { topic: name, title: topicTitles[name], text: renderTopic(name), topics: guideTopicNames };
  }
  const page = findSkillPage(name);
  if (!page) throw new ProductError("NOT_FOUND", `guide topic ${name}; topics: ${guideTopicNames.join(", ")}`);
  return { topic: page.topic, title: page.title, text: page.text, topics: guideTopicNames };
}
