import { skillFiles } from "./skill-files.js";

/** One page of a skill as the guide serves it: the file's own Markdown, unchanged. */
export interface SkillPage {
  /** The guide topic: the skill name, or `<skill>/references/<name>`. */
  readonly topic: string;
  readonly title: string;
  readonly text: string;
}

export interface GuideSkill {
  readonly name: string;
  /** The one-line description from the skill's frontmatter. */
  readonly description: string;
  readonly page: SkillPage;
  readonly references: readonly SkillPage[];
}

/**
 * The skill that only routes to the guide. It is served like the others, but the start page does not list it: it is
 * the on-disk copy of that page.
 */
export const routerSkillName = "ai-engineer";

const skillFileName = "SKILL.md";
const frontmatterBlock = /^---\n([\s\S]*?)\n---\n?/;

/** The frontmatter fields of a skill file (`name`, `description`); empty when the file has none. */
export function skillFrontmatter(text: string): Readonly<Record<string, string>> {
  const block = frontmatterBlock.exec(text)?.[1] ?? "";
  const fields: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const separator = line.indexOf(":");
    if (separator > 0) fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return fields;
}

function pageFor(path: string, source: string): SkillPage {
  const text = source.replace(/\r\n/g, "\n").trimEnd();
  const topic = path.replace(/\.md$/, "").replace(new RegExp(`/${skillFileName.replace(/\.md$/, "")}$`), "");
  const heading = /^# (.+)$/m.exec(text.replace(frontmatterBlock, ""))?.[1];
  return { topic, title: heading?.trim() || topic, text };
}

function buildSkills(files: Readonly<Record<string, string>>): GuideSkill[] {
  const paths = Object.keys(files).sort();
  const names = [...new Set(paths.map((path) => path.slice(0, path.indexOf("/"))))].sort();
  return names.flatMap((name) => {
    const source = files[`${name}/${skillFileName}`];
    if (source === undefined) return [];
    const references = paths
      .filter((path) => path.startsWith(`${name}/references/`))
      .map((path) => pageFor(path, files[path] ?? ""));
    const description = skillFrontmatter(source.replace(/\r\n/g, "\n")).description ?? "";
    return [{ name, description, page: pageFor(`${name}/${skillFileName}`, source), references }];
  });
}

/** Every skill in `skills/`, with its references, in name order. */
export const guideSkills: readonly GuideSkill[] = buildSkills(skillFiles);

/** The skills that hold a method, which the start page lists beside the jobs. */
export const methodSkills: readonly GuideSkill[] = guideSkills.filter((skill) => skill.name !== routerSkillName);

const skillPages: readonly SkillPage[] = guideSkills.flatMap((skill) => [skill.page, ...skill.references]);

/** Guide topics served from `skills/`: each skill name, then its references. */
export const skillTopics: readonly string[] = skillPages.map((page) => page.topic);

export function findSkillPage(topic: string): SkillPage | undefined {
  return skillPages.find((page) => page.topic === topic);
}
