/**
 * Source-token FORMAT helpers. A stream source token authenticates a log
 * shipper to exactly one stream on the ingest endpoints. The full secret is
 * shown to the operator ONCE at mint time; only its sha256 hash and an 8-char
 * display prefix are stored.
 *
 * Format: `ckls_<streamIdShort>_<32B base64url>` where `streamIdShort` is the
 * first 8 chars of the stream id (a human hint only - never trusted for auth;
 * the hash lookup resolves the real stream) and the trailing segment is 32
 * random bytes, base64url-encoded (no padding).
 *
 * BROWSER-SAFETY INVARIANT: this package is imported by the frontend bundle,
 * so it must contain NO node builtins. A top-level `node:crypto` import here
 * once made Vite externalize the module and the whole logstream frontend
 * plugin failed to load (no nav, no routes, no editor dropdown resolvers).
 * The hashing and minting halves (`hashToken`, `generateToken`) therefore
 * live in `logstream-backend/src/token-crypto.ts`; the `browser-safety` guard
 * test in this package enforces the invariant. NEVER log or echo a full
 * secret.
 */

/** Prefix that marks a value as a logstream source token. */
export const TOKEN_PREFIX = "ckls_";

/** How many leading characters of the FULL token are kept for display. */
export const TOKEN_DISPLAY_PREFIX_LENGTH = 8;

/** True if a value has the `ckls_` shape (cheap pre-filter before hashing). */
export function isLogstreamToken(value: string): boolean {
  return value.startsWith(TOKEN_PREFIX);
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
 * logstream-shaped token is present. Does NOT verify - the caller hashes and
 * looks it up.
 */
export function extractIngestToken({
  authorization,
  checkstackToken,
}: {
  authorization?: string | null;
  checkstackToken?: string | null;
}): string | null {
  if (checkstackToken && isLogstreamToken(checkstackToken.trim())) {
    return checkstackToken.trim();
  }
  if (authorization) {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    const candidate = match?.[1]?.trim();
    if (candidate && isLogstreamToken(candidate)) {
      return candidate;
    }
  }
  return null;
}
