import { ProductError } from "@aiengineer/service-contracts";

export type Options = Readonly<Record<string, string | boolean | undefined>>;

export function stringOption(options: Options, name: string): string | undefined {
  const value = options[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function requiredOption(options: Options, name: string): string {
  const value = stringOption(options, name);
  if (!value) throw new ProductError("VALIDATION", `--${name} is required`);
  return value;
}

/** A comma-separated option as a list: `--lens corpus,evidence`. */
export function listOption(options: Options, name: string): string[] | undefined {
  const values = stringOption(options, name)
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return values && values.length > 0 ? values : undefined;
}

export function numberOption(options: Options, name: string): number | undefined {
  const value = stringOption(options, name);
  if (value === undefined) return undefined;
  if (!/^[0-9]+$/.test(value)) throw new ProductError("VALIDATION", `--${name} must be a number`);
  return Number(value);
}

export function oneOf<T extends string>(value: string, allowed: readonly T[], name: string): T {
  if (!(allowed as readonly string[]).includes(value))
    throw new ProductError("VALIDATION", `--${name} must be one of ${allowed.join(", ")}`);
  return value as T;
}

/** A required positional argument. */
export function argument(value: string | undefined, name: string): string {
  if (!value) throw new ProductError("VALIDATION", `${name} required`);
  return value;
}
