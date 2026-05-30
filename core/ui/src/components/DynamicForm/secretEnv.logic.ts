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

/** Extract the secret name from a `${{ secrets.NAME }}` template, or "". */
export function parseSecretName(template: string): string {
  const match = TEMPLATE_RE.exec(template);
  return match?.[1] ?? "";
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
