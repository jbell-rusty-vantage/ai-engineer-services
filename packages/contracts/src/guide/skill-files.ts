import router from "../../../../skills/ai-engineer/SKILL.md";
import charter from "../../../../skills/ai-engineer-knowledge-charter/SKILL.md";
import evidenceBinding from "../../../../skills/content-authoring/references/evidence-binding.md";
import lessonCraft from "../../../../skills/content-authoring/references/lesson-craft.md";
import reviewAndRelease from "../../../../skills/content-authoring/references/review-and-release.md";
import structure from "../../../../skills/content-authoring/references/structure.md";
import workedExample from "../../../../skills/content-authoring/references/worked-example.md";
import contentAuthoring from "../../../../skills/content-authoring/SKILL.md";

/**
 * The pages of `skills/` that the guide serves, by their path under that folder: every `SKILL.md` and every file under
 * a skill's `references/`. A bundler needs each import written out; `guide.test.ts` fails when this list and the
 * folder differ, so a new skill or reference cannot be forgotten. Other files in a skill folder (its sources record)
 * are not served.
 */
export const skillFiles: Readonly<Record<string, string>> = {
  "ai-engineer/SKILL.md": router,
  "ai-engineer-knowledge-charter/SKILL.md": charter,
  "content-authoring/SKILL.md": contentAuthoring,
  "content-authoring/references/evidence-binding.md": evidenceBinding,
  "content-authoring/references/lesson-craft.md": lessonCraft,
  "content-authoring/references/review-and-release.md": reviewAndRelease,
  "content-authoring/references/structure.md": structure,
  "content-authoring/references/worked-example.md": workedExample,
};
