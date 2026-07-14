/**
 * Source-token FORMAT helpers. A trace-stream source token authenticates a
 * shipper (OTLP/native span pusher) to exactly one stream on the ingest
 * endpoints. The full secret is shown to the operator ONCE at mint time; only
 * its sha256 hash and an 8-char display prefix are stored.
 *
 * Format: `cktr_<streamIdShort>_<32B base64url>` - identical scheme to the
 * `ckls_`/`ckms_` tokens (see metricstream-common/src/token.ts for the full
 * rationale).
 *
 * BROWSER-SAFETY INVARIANT: this package is imported by the frontend bundle,
 * so it must contain NO node builtins. The hashing/minting halves live in
 * `@checkstack/ingest-utils`' source-token kit (instantiated with the `cktr_`
 * prefix in the backend); these pure format helpers are the deliberate
 * browser-safe duplicates of the kit's format half. NEVER log a full secret.
 */

/** Prefix that marks a value as a tracestream source token. */
export const TRACESTREAM_TOKEN_PREFIX = "cktr_";

/** How many leading characters of the FULL token are kept for display. */
export const TRACESTREAM_TOKEN_DISPLAY_PREFIX_LENGTH = 8;

/** True if a value has the `cktr_` shape (cheap pre-filter before hashing). */
export function isTracestreamToken(value: string): boolean {
  return value.startsWith(TRACESTREAM_TOKEN_PREFIX);
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
 * tracestream-shaped token is present. Does NOT verify - the caller hashes and
 * looks it up.
 */
export function extractIngestToken({
  authorization,
  checkstackToken,
}: {
  authorization?: string | null;
  checkstackToken?: string | null;
}): string | null {
  if (checkstackToken && isTracestreamToken(checkstackToken.trim())) {
    return checkstackToken.trim();
  }
  if (authorization) {
    const match = /^bearer\s+(.+)$/i.exec(authorization.trim());
    const candidate = match?.[1]?.trim();
    if (candidate && isTracestreamToken(candidate)) return candidate;
  }
  return null;
}
