import {
  createSourceTokenKit,
  type GeneratedSourceToken,
} from "@checkstack/ingest-utils";
import {
  TRACESTREAM_TOKEN_PREFIX,
  TRACESTREAM_TOKEN_DISPLAY_PREFIX_LENGTH,
} from "@checkstack/tracestream-common";

/**
 * The node:crypto side of tracestream's source-token helpers (hashing +
 * minting), built on the shared `@checkstack/ingest-utils` source-token kit and
 * bound to tracestream's `cktr_` prefix.
 *
 * These live in the BACKEND package deliberately: `@checkstack/tracestream-common`
 * is imported by the browser bundle, and a top-level `node:crypto` import there
 * (which the kit pulls in) would make Vite externalize the module and break the
 * whole frontend plugin at load time. Keep every node builtin - including this
 * kit - out of `tracestream-common`; the pure format helpers (prefix, parse,
 * extract) stay there and are guarded by a browser-safety test.
 *
 * NEVER log or echo a full secret.
 */

const tokenKit = createSourceTokenKit({
  prefix: TRACESTREAM_TOKEN_PREFIX,
  displayPrefixLength: TRACESTREAM_TOKEN_DISPLAY_PREFIX_LENGTH,
});

export type GeneratedToken = GeneratedSourceToken;

/** The shared source-token kit (hashing + minting), for the ingest authenticator. */
export { tokenKit };

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
