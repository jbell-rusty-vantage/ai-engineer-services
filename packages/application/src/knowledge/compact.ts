/** Small helpers that keep knowledge answers compact enough for an agent to read. */

export type Row = Readonly<Record<string, unknown>>;

/** Collapses whitespace and cuts at `limit` characters. */
export function oneLine(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1).trimEnd()}…`;
}

export function clip(value: unknown, limit: number): string | null {
  return typeof value === "string" && value.trim() ? oneLine(value, limit) : null;
}

export function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** Keeps a JSON value when it is small; otherwise a clipped preview of its text. */
export function smallJson(value: unknown, limit: number): unknown {
  if (value === null || value === undefined) return null;
  const serialized = JSON.stringify(value);
  return serialized.length <= limit ? value : `${serialized.slice(0, limit - 1)}…`;
}

/** The named columns of a row, in order. */
export function pick(row: Row, columns: readonly string[]): Row {
  return Object.fromEntries(columns.map((column) => [column, row[column] ?? null]));
}

export function asRows(value: unknown): Row[] {
  return Array.isArray(value) ? (value as Row[]) : [];
}
