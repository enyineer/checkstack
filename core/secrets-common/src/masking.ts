/**
 * Jenkins-style by-value secret masking.
 *
 * This is the platform's non-negotiable leak guarantee: any text returned
 * to a user or persisted is scanned for known secret values and every
 * literal occurrence is replaced with a redaction token.
 *
 * Documented limit: only LITERAL occurrences are masked. Encoded or
 * transformed forms of a secret (base64, hashed, URL-encoded, split
 * across lines) cannot be detected — scripts must not transform-then-print
 * a secret they were given.
 */

/** Default redaction token. */
export const DEFAULT_MASK_TOKEN = "****";

/**
 * Values shorter than this are NOT masked. Trivially short secrets (e.g.
 * a 1-3 char value) would over-mask unrelated coincidental substrings of
 * normal output, corrupting it. Anything below the threshold is skipped.
 */
export const MIN_MASKABLE_LENGTH = 4;

/**
 * Replace every literal occurrence of each known secret value in `text`
 * with `token`. Pure and synchronous.
 *
 * - Skips values shorter than {@link MIN_MASKABLE_LENGTH}.
 * - Longer values are masked first, so a secret that contains a shorter
 *   secret as a substring is fully redacted before the shorter one runs.
 * - `values` is the run-scoped, least-privilege set — only the consumer's
 *   resolved secrets, never the whole secret store.
 *
 * @returns The text with all qualifying secret values redacted.
 */
export function maskSecrets({
  text,
  values,
  token = DEFAULT_MASK_TOKEN,
}: {
  text: string;
  values: Iterable<string>;
  token?: string;
}): string {
  // Dedupe + drop trivially-short values, then mask longest-first so a
  // value that embeds a shorter value is redacted as a whole.
  const maskable = [...new Set(values)]
    .filter((value) => value.length >= MIN_MASKABLE_LENGTH)
    .toSorted((a, b) => b.length - a.length);

  let result = text;
  for (const value of maskable) {
    if (result.includes(value)) {
      result = result.split(value).join(token);
    }
  }
  return result;
}

/**
 * Recursively mask secret values in an arbitrary JSON-like payload. Walks
 * strings, arrays, and plain objects; non-string leaves are returned
 * unchanged. Used to redact structured result payloads (e.g. an
 * automation run step's `result_payload`) before persist/return.
 *
 * Object KEYS are masked too — a script that returns `{ "<secret>": 1 }`
 * would otherwise leak the value through the key.
 */
export function maskSecretsDeep({
  value,
  values,
  token = DEFAULT_MASK_TOKEN,
}: {
  value: unknown;
  values: Iterable<string>;
  token?: string;
}): unknown {
  const maskable = [...new Set(values)]
    .filter((v) => v.length >= MIN_MASKABLE_LENGTH)
    .toSorted((a, b) => b.length - a.length);

  if (maskable.length === 0) {
    return value;
  }

  return walk(value, maskable, token);
}

function walk(value: unknown, maskable: string[], token: string): unknown {
  if (typeof value === "string") {
    return maskString(value, maskable, token);
  }
  if (Array.isArray(value)) {
    return value.map((item) => walk(item, maskable, token));
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[maskString(key, maskable, token)] = walk(val, maskable, token);
    }
    return result;
  }
  return value;
}

function maskString(text: string, maskable: string[], token: string): string {
  let result = text;
  for (const value of maskable) {
    if (result.includes(value)) {
      result = result.split(value).join(token);
    }
  }
  return result;
}
