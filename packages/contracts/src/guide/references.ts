/**
 * What a guide page names. Guide pages follow one convention so this stays mechanical: a code span either starts with
 * a tool or operation name (optionally followed by its arguments in braces), starts with `aieng`, or is a literal
 * (a path, a route, or a quoted value such as `"release_review"`). Field names are never written as bare code spans.
 */
export interface GuideReferences {
  /** Tool and operation names. */
  readonly names: readonly string[];
  /** `aieng` command lines, as the words after `aieng` up to the first argument or option. */
  readonly commands: readonly (readonly string[])[];
}

const codeSpan = /`([^`\n]+)`/g;
const compoundName = /^[a-z]+(?:_[a-z0-9]+)+$/;
const callWithArguments = /^([a-z][a-z_0-9]*) \{/;
/** A command word; a guide topic may hold slashes (`content-authoring/references/lesson-craft`). */
const commandWord = /^[a-z][a-z_0-9/-]*$/;

function commandWords(span: string): string[] {
  const words: string[] = [];
  for (const word of span.split(/\s+/).slice(1)) {
    if (!commandWord.test(word)) break;
    words.push(word);
  }
  return words;
}

export function scanGuideReferences(text: string): GuideReferences {
  const names = new Set<string>();
  const commands = new Map<string, string[]>();
  for (const match of text.matchAll(codeSpan)) {
    const span = (match[1] ?? "").trim();
    if (span === "aieng" || span.startsWith("aieng ")) {
      const words = commandWords(span);
      if (words.length > 0) commands.set(words.join(" "), words);
      continue;
    }
    const first = span.split(/\s+/)[0] ?? "";
    if (compoundName.test(first)) names.add(first);
    else {
      const call = callWithArguments.exec(span);
      if (call?.[1]) names.add(call[1]);
    }
  }
  return { names: [...names], commands: [...commands.values()] };
}
