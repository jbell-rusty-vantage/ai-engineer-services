/**
 * Skill pages are Markdown files under `skills/`. The build inlines them as text (tsup `--loader .md=text`), and
 * `vitest.config.ts` does the same for tests, so the built package carries the pages and reads no file at run time.
 */
declare module "*.md" {
  const text: string;
  export default text;
}
