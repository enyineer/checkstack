/**
 * Source-token FORMAT helpers. A metric-stream source token authenticates a
 * shipper (OTLP/native pusher) to exactly one stream on the ingest endpoints.
 * The full secret is shown to the operator ONCE at mint time; only its sha256
 * hash and an 8-char display prefix are stored.
 *
 * Format: `ckms_<streamIdShort>_<32B base64url>` where `streamIdShort` is the
 * first 8 alphanumeric chars of the stream id (a human hint only - never
 * trusted for auth; the hash lookup resolves the real stream) and the trailing
 * segment is 32 random bytes, base64url-encoded (no padding).
 *
 * BROWSER-SAFETY INVARIANT: this package is imported by the frontend bundle,
 * so it must contain NO node builtins (a top-level `node:crypto` import here
 * would make Vite externalize the module and the whole metricstream frontend
 * plugin would fail to load - the logstream regression). The hashing and
 * minting halves live in `@checkstack/ingest-utils`' source-token kit
 * (instantiated with the `ckms_` prefix in the backend); the `browser-safety`
 * guard test in this package enforces the invariant. These pure format helpers
 * are the small, deliberate browser-safe duplicates of the kit's format half.
 * NEVER log or echo a full secret.
 */

/** Prefix that marks a value as a metricstream source token. */
export const METRICSTREAM_TOKEN_PREFIX = "ckms_";

/** How many leading characters of the FULL token are kept for display. */
export const METRICSTREAM_TOKEN_DISPLAY_PREFIX_LENGTH = 8;

/** True if a value has the `ckms_` shape (cheap pre-filter before hashing). */
export function isMetricstreamToken(value: string): boolean {
  return value.startsWith(METRICSTREAM_TOKEN_PREFIX);
}

/**
 * Shorten a stream id to the hint segment embedded in a token. Non-alphanumeric
 * characters are stripped so the token stays URL/header safe.
 */
export function shortStreamId(streamId: string): string {
  return streamId.replaceAll(/[^0-9a-zA-Z]/g, "").slice(0, 8);
}

/**
 * Extract a bearer token from an ingest request's headers. Accepts
 * `Authorization: Bearer <token>` (case-insensitive scheme) or the
 * `X-Checkstack-Token` header. Returns the raw token string, or `null` when no
 * metricstream-shaped token is present. Does NOT verify - the caller hashes and
 * looks it up.
 */
export function extractIngestToken({
  authorization,
  checkstackToken,
}: {
  authorization?: string | null;
  checkstackToken?: string | null;
}): string | null {
  if (checkstackToken && isMetricstreamToken(checkstackToken.trim())) {
    return checkstackToken.trim();
  }
  if (authorization) {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    const candidate = match?.[1]?.trim();
    if (candidate && isMetricstreamToken(candidate)) {
      return candidate;
    }
  }
  return null;
}
