import { createSourceTokenKit, type GeneratedSourceToken } from "@checkstack/ingest-utils";
import { TOKEN_PREFIX, TOKEN_DISPLAY_PREFIX_LENGTH } from "@checkstack/logstream-common";

/**
 * The node:crypto side of logstream's source-token helpers (hashing + minting),
 * built on the shared `@checkstack/ingest-utils` source-token kit and bound to
 * logstream's `ckls_` prefix.
 *
 * These live in the BACKEND package deliberately: `@checkstack/logstream-common`
 * is imported by the browser bundle, and a top-level `node:crypto` import there
 * (which the kit pulls in) once made Vite externalize the module and the ENTIRE
 * logstream frontend plugin failed to load. Keep every node builtin - including
 * this kit - out of `logstream-common`; the pure format helpers (prefix, parse,
 * extract) stay there. `logstream-common` has a guard test for this invariant.
 *
 * NEVER log or echo a full secret.
 */

const tokenKit = createSourceTokenKit({
  prefix: TOKEN_PREFIX,
  displayPrefixLength: TOKEN_DISPLAY_PREFIX_LENGTH,
});

export type GeneratedToken = GeneratedSourceToken;

/** sha256 hex digest of a full token secret - the stored/compared form. */
export function hashToken(secret: string): string {
  return tokenKit.hashToken(secret);
}

/**
 * Mint a new source token for a stream. Returns the one-time secret plus the
 * hash and display prefix to persist.
 */
export function generateToken({ streamId }: { streamId: string }): GeneratedToken {
  return tokenKit.generateToken({ resourceId: streamId });
}
