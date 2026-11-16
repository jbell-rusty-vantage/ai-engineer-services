import { defineConfig } from "vitest/config";

/** Skill pages are imported as text, the way the build inlines them (tsup `--loader .md=text`). */
export default defineConfig({
  plugins: [
    {
      name: "markdown-as-text",
      transform(code, id) {
        return id.endsWith(".md") ? { code: `export default ${JSON.stringify(code)};`, map: null } : undefined;
      },
    },
  ],
});
