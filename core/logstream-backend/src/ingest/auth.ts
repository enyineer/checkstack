/**
 * Push-token authentication for the logstream ingest endpoints. The mechanism
 * (positive verdict cache, bounded negative cache, cross-pod miss marker,
 * constant-time hash confirm) lives in `@checkstack/ingest-utils`; this module
 * binds it to logstream's `hashToken` and the `streamId`-shaped
 * {@link AuthResult} the ingest endpoints consume. The token LOOKUP itself is
 * the platform's `createPushTokenLookup` (an `IngestTokenLookup` over the
 * `logstream.push` source type), wired in `./setup.ts`.
 *
 * The token-cache KEY convention is OWNED by the API area (see
 * `../api/token-cache`) so the platform's push-token invalidation converges the
 * SAME key this path caches under; both delegate to the shared ingest-utils
 * builders.
 */

import type { CachedScope } from "@checkstack/cache-utils";
import {
  createIngestAuthenticator as createGenericIngestAuthenticator,
  type IngestTokenLookup,
} from "@checkstack/ingest-utils";
import { hashToken } from "../token-crypto";

// The negative-cache class, key builders, and TTL/size constants are owned by
// `@checkstack/ingest-utils`; re-exported here under logstream's names so the
// coordinated revoke/mint paths and tests keep importing them from this module.
export {
  NegativeTokenCache,
  ingestTokenMissKey,
  INGEST_TOKEN_MISS_PREFIX,
  TOKEN_CACHE_TTL_MS,
  NEGATIVE_CACHE_MAX,
  NEGATIVE_CACHE_TTL_MS,
} from "@checkstack/ingest-utils";

export type AuthResult =
  | { ok: true; streamId: string; tokenId: string }
  | { ok: false; reason: "unknown" | "revoked" };

export interface IngestAuthenticator {
  /** Resolve a raw `ckls_` token to its stream, or a rejection reason. */
  verify(token: string): Promise<AuthResult>;
  /** Evict a token hash from the negative caches (see the shared module doc). */
  clearNegative?(tokenHash: string): Promise<void>;
}

/**
 * Resolve a token hash to its row (or null). The production lookup is the
 * platform's `createPushTokenLookup`; tests inject their own. Re-exported as
 * logstream's own name so the existing tests and wiring keep a single import.
 */
export type TokenLookup = IngestTokenLookup;

export function createIngestAuthenticator({
  lookup,
  cache,
  now,
}: {
  lookup: TokenLookup;
  cache: CachedScope;
  /** Millisecond clock, injectable for deterministic negative-cache tests. */
  now?: () => number;
}): IngestAuthenticator {
  const inner = createGenericIngestAuthenticator({
    lookup,
    cache,
    hashToken,
    now,
  });

  return {
    async verify(token) {
      const result = await inner.verify(token);
      return result.ok
        ? { ok: true, streamId: result.resourceId, tokenId: result.tokenId }
        : result;
    },
    clearNegative: (tokenHash) => inner.clearNegative!(tokenHash),
  };
}
