import { createSourceTokenKit } from "@checkstack/ingest-utils";
import {
  TRACESTREAM_TOKEN_PREFIX,
  TRACESTREAM_TOKEN_DISPLAY_PREFIX_LENGTH,
} from "@checkstack/tracestream-common";

/**
 * The node:crypto side of tracestream's source-token helpers (hashing +
 * minting), built on the shared `@checkstack/ingest-utils` source-token kit and
 * bound to tracestream's `cktr_` prefix.
 *
 * Push-token MINTING is now owned by the telemetry platform; the ingest path
 * only needs the kit's sha256 `hashToken` to key the ingest-token cache the same
 * way `createIngestAuthenticator` does. (The tests also mint sample tokens with
 * the kit to drive the verify path.)
 *
 * This lives in the BACKEND package deliberately: `@checkstack/tracestream-common`
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

/** The shared source-token kit (hashing + minting), for the ingest authenticator. */
export { tokenKit };
