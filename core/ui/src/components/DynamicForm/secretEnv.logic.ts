/**
 * Pure parse/serialize helpers for {@link SecretEnvEditor}. Kept separate
 * so they can be unit-tested without rendering React.
 *
 * The stored shape is `{ ENV_NAME: "${{ secrets.NAME }}" }`; the editor
 * works with rows of `{ envName, secretName }`.
 */

export interface SecretEnvRow {
  envName: string;
  secretName: string;
}

const TEMPLATE_RE = /^\s*\$\{\{\s*secrets\.([a-zA-Z0-9_-]+)\s*\}\}\s*$/;
// A pure bare secret name (mirrors SECRET_NAME_REGEX in @checkstack/secrets-common).
const BARE_NAME_RE = /^\s*([a-zA-Z][a-zA-Z0-9_-]*)\s*$/;

/**
 * Extract the secret name for display from a stored mapping value. Accepts
 * either the canonical `${{ secrets.NAME }}` template OR a legacy / YAML
 * shorthand bare secret name (the schema tolerates and normalizes bare names
 * on write, so existing data may still carry one). Returns "" for anything
 * that is neither (e.g. inline interpolation), so the picker stays empty.
 */
export function parseSecretName(template: string): string {
  const templateMatch = TEMPLATE_RE.exec(template);
  if (templateMatch) return templateMatch[1];
  const bareMatch = BARE_NAME_RE.exec(template);
  return bareMatch?.[1] ?? "";
}

/** Render a secret name as its canonical `${{ secrets.NAME }}` template. */
export function toSecretTemplate(secretName: string): string {
  return secretName ? `\${{ secrets.${secretName} }}` : "";
}

export function objectToRows(
  value: Record<string, string>,
): SecretEnvRow[] {
  return Object.entries(value).map(([envName, template]) => ({
    envName,
    secretName: parseSecretName(template),
  }));
}

export function rowsToObject(rows: SecretEnvRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    // Drop incomplete rows (empty env name or secret) on serialize.
    if (row.envName.trim() === "" || row.secretName.trim() === "") continue;
    out[row.envName.trim()] = toSecretTemplate(row.secretName.trim());
  }
  return out;
}

/**
 * Given the editor rows and the list of secret names known to exist (from
 * the secrets plugin's `listSecretNames`), return the de-duplicated set of
 * referenced secret names that are NOT in that list.
 *
 * Used to surface a non-blocking "this secret doesn't exist" warning on a
 * row — the name may have been deleted/renamed, or be created later, so it
 * round-trips regardless. Returns an empty set when:
 *   - `secretNames` is `undefined` (still loading; we don't warn early), or
 *   - `secretNames` is empty (treated as "list unknown", same as loading), or
 *   - every referenced name is known.
 *
 * Blank secret names are ignored (a half-typed row isn't an error yet).
 */
export function unknownSecretNames({
  rows,
  secretNames,
}: {
  rows: SecretEnvRow[];
  secretNames: string[] | undefined;
}): Set<string> {
  // No list to validate against → never warn (loading / unavailable).
  if (!secretNames || secretNames.length === 0) return new Set();
  const known = new Set(secretNames);
  const unknown = new Set<string>();
  for (const row of rows) {
    const name = row.secretName.trim();
    if (name === "") continue;
    if (!known.has(name)) unknown.add(name);
  }
  return unknown;
}
