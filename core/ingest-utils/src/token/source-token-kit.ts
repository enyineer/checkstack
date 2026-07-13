/**
 * Source-token kit: the node:crypto side of a source-token scheme, generalized
 * over the token prefix so any ingest plugin can mint its own tokens (logstream
 * `ckls_`, metricstream `ckms_`, ...).
 *
 * A source token authenticates a shipper to exactly one resource on the ingest
 * endpoints. The full secret is shown to the operator ONCE at mint time; only
 * its sha256 hash and a short display prefix are stored at rest.
 *
 * Format: `<prefix><resourceIdShort>_<N random bytes base64url>` where
 * `resourceIdShort` is the first 8 alphanumeric chars of the resource id (a
 * human hint only - never trusted for auth; the hash lookup resolves the real
 * resource) and the trailing segment is `secretBytes` random bytes, base64url
 * encoded (no padding).
 *
 * BROWSER-SAFETY: this module imports `node:crypto`, so it is BACKEND-ONLY.
 * A plugin's browser-safe FORMAT half (prefix, `isToken`, `shortId`,
 * `extractToken`) must stay in its own `*-common` package - do NOT import this
 * kit from a package that ships to the browser. The kit re-implements the same
 * pure format helpers here (small, deliberate duplicates of the common half) so
 * backends can share one instance without reaching for the browser bundle.
 *
 * NEVER log or echo a full secret.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** How many leading chars of the FULL secret are kept for display by default. */
export const DEFAULT_TOKEN_DISPLAY_PREFIX_LENGTH = 8;
/** Random secret byte count for the trailing token segment by default. */
export const DEFAULT_TOKEN_SECRET_BYTES = 32;
/** How many alphanumeric chars of a resource id form the embedded hint. */
const RESOURCE_ID_HINT_LENGTH = 8;

export interface GeneratedSourceToken {
  /** The full secret. Return to the operator ONCE; never persist. */
  secret: string;
  /** sha256 hex of the full secret - the only form stored at rest. */
  tokenHash: string;
  /** First `displayPrefixLength` chars of the secret, for display. */
  tokenPrefix: string;
}

export interface SourceTokenKit {
  /** The configured token prefix (e.g. `ckls_`). */
  readonly prefix: string;
  /** How many leading chars of the secret this kit keeps for display. */
  readonly displayPrefixLength: number;
  /** True if a value has this kit's prefix (cheap pre-filter before hashing). */
  isToken(value: string): boolean;
  /**
   * Shorten a resource id to the hint segment embedded in a token.
   * Non-alphanumeric characters are stripped so the token stays URL/header safe.
   */
  shortId(resourceId: string): string;
  /**
   * Extract a bearer token from an ingest request's headers. Accepts
   * `Authorization: Bearer <token>` (case-insensitive scheme) or the
   * `X-Checkstack-Token` header. Returns the raw token string, or `null` when no
   * token with this kit's prefix is present. Does NOT verify - the caller hashes
   * and looks it up.
   */
  extractToken(input: {
    authorization?: string | null;
    checkstackToken?: string | null;
  }): string | null;
  /** sha256 hex digest of a full token secret - the stored/compared form. */
  hashToken(secret: string): string;
  /**
   * Mint a new source token for a resource. Returns the one-time secret plus the
   * hash and display prefix to persist.
   */
  generateToken(input: { resourceId: string }): GeneratedSourceToken;
}

/**
 * Shorten a resource id to the hint segment embedded in a token. Prefix- and
 * kit-independent, so it lives at module scope.
 */
function shortId(resourceId: string): string {
  return resourceId.replaceAll(/[^0-9a-zA-Z]/g, "").slice(0, RESOURCE_ID_HINT_LENGTH);
}

/** sha256 hex digest of a full token secret - the stored/compared form. */
function hashToken(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function createSourceTokenKit({
  prefix,
  displayPrefixLength = DEFAULT_TOKEN_DISPLAY_PREFIX_LENGTH,
  secretBytes = DEFAULT_TOKEN_SECRET_BYTES,
}: {
  prefix: string;
  displayPrefixLength?: number;
  secretBytes?: number;
}): SourceTokenKit {
  function isToken(value: string): boolean {
    return value.startsWith(prefix);
  }

  function extractToken({
    authorization,
    checkstackToken,
  }: {
    authorization?: string | null;
    checkstackToken?: string | null;
  }): string | null {
    if (checkstackToken && isToken(checkstackToken.trim())) {
      return checkstackToken.trim();
    }
    if (authorization) {
      // Match only the "Bearer " scheme prefix, then slice the remainder -
      // never a `\s+(.+)` capture, whose overlapping quantifiers backtrack
      // polynomially on crafted whitespace (CodeQL js/polynomial-redos).
      const trimmed = authorization.trim();
      const scheme = /^Bearer\s+/i.exec(trimmed);
      if (scheme) {
        const candidate = trimmed.slice(scheme[0].length).trim();
        if (candidate && isToken(candidate)) {
          return candidate;
        }
      }
    }
    return null;
  }

  function generateToken({ resourceId }: { resourceId: string }): GeneratedSourceToken {
    const random = randomBytes(secretBytes).toString("base64url");
    const secret = `${prefix}${shortId(resourceId)}_${random}`;
    return {
      secret,
      tokenHash: hashToken(secret),
      tokenPrefix: secret.slice(0, displayPrefixLength),
    };
  }

  return {
    prefix,
    displayPrefixLength,
    isToken,
    shortId,
    extractToken,
    hashToken,
    generateToken,
  };
}

/** Constant-time compare of two equal-length lowercase hex strings. */
export function constantTimeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}
