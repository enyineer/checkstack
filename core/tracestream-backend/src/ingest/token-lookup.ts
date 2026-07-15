/**
 * Push-token lookup for the ingest authenticator. Tracestream no longer owns a
 * token table: the telemetry platform stores every push instance's `cktr_`
 * token hash on `telemetry_sources.push_token_hash`, so this builds the shared
 * {@link IngestTokenLookup} over the platform's push-token VERIFIER (resolved
 * cross-plugin through `telemetryPushTokenVerifierRef`), scoped to the
 * `tracestream.push` source type and the `traces` signal.
 *
 * The verifier's verdicts map onto the authenticator exactly:
 * - unknown hash, or a token of another push type -> `null` (cached negatively);
 * - a disabled instance, or one without a `traces` binding -> a revoked row;
 * - an enabled instance bound for `traces` -> a row whose `resourceId` is the
 *   bound stream id and whose `tokenId` is the source instance id.
 */

import {
  createPushTokenLookup,
  type PushTokenVerifier,
} from "@checkstack/telemetry-backend";
import type { IngestTokenLookup } from "@checkstack/ingest-utils";
import { TRACESTREAM_PUSH_SOURCE_TYPE_ID } from "./push-source-type";

/**
 * Build the `tracestream.push` ingest-token lookup. `resourceId` on a verified
 * row is the bound trace stream id; `tokenId` is the push source instance id
 * (fed to {@link PushTokenVerifier.recordPushSeen} for last-seen stamping).
 */
export function createTracestreamPushTokenLookup({
  verifier,
}: {
  verifier: PushTokenVerifier;
}): IngestTokenLookup {
  return createPushTokenLookup({
    verifier,
    sourceTypeId: TRACESTREAM_PUSH_SOURCE_TYPE_ID,
    signal: "traces",
  });
}
