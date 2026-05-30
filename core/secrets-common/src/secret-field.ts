import { z } from "zod";

/**
 * Valid characters for a secret name: must start with a letter, then
 * letters, digits, underscores, and hyphens. This is the canonical
 * definition for the whole platform — the legacy copy in
 * `@checkstack/gitops-common` mirrors this regex (kept in sync).
 *
 * Must stay in sync with the capture group in {@link SECRET_TEMPLATE_REGEX}.
 */
export const SECRET_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

/**
 * Zod schema for validating secret names at creation time.
 * Ensures the name can be referenced via `${{ secrets.NAME }}`.
 */
export const secretNameSchema = z
  .string()
  .min(1)
  .max(63)
  .regex(
    SECRET_NAME_REGEX,
    "Secret names must start with a letter and contain only letters, digits, underscores, or hyphens",
  );

export type SecretName = z.infer<typeof secretNameSchema>;

/**
 * Regex matching `${{ secrets.NAME }}` template expressions in strings.
 * Captures the secret name in group 1. Global so multiple occurrences in
 * a single string are matched.
 *
 * @example
 * "${{ secrets.DB_PASS }}" → captures "DB_PASS"
 * "postgres://u:${{ secrets.PASS }}@${{ secrets.HOST }}/db" → "PASS", "HOST"
 */
export const SECRET_TEMPLATE_REGEX =
  /\$\{\{\s*secrets\.([a-zA-Z0-9_-]+)\s*\}\}/g;

/**
 * Zod schema for validating secret template strings.
 * Matches strings containing at least one `${{ secrets.NAME }}` pattern.
 */
export const secretTemplateSchema = z.string().regex(
  /\$\{\{\s*secrets\.[a-zA-Z0-9_-]+\s*\}\}/,
  "Must contain a ${{ secrets.NAME }} reference",
);

/**
 * Recursively walks a value and collects all unique secret names
 * referenced via `${{ secrets.NAME }}` patterns in string values.
 *
 * @returns Deduplicated array of secret names found in the value tree.
 */
export function collectSecretNames({ value }: { value: unknown }): string[] {
  const names = new Set<string>();
  collectFromValue(value, names);
  return [...names];
}

function collectFromValue(value: unknown, names: Set<string>): void {
  if (value === null || value === undefined) {
    return;
  }

  if (typeof value === "string") {
    SECRET_TEMPLATE_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = SECRET_TEMPLATE_REGEX.exec(value)) !== null) {
      names.add(match[1]);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectFromValue(item, names);
    }
    return;
  }

  if (typeof value === "object") {
    for (const val of Object.values(value)) {
      collectFromValue(val, names);
    }
  }
}
