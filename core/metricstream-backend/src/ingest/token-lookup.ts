/**
 * Push-token lookup for the ingest authenticator. Delegates to the telemetry
 * platform's push-token verifier (resolved cross-plugin through
 * `telemetryPushTokenVerifierRef`): the plugin no longer owns a token table, so
 * a presented `ckms_` token is resolved against `telemetry_sources` scoped to the
 * `metricstream.push` source type and the `metrics` signal.
 *
 * Verdicts (see {@link createPushTokenLookup}): an unknown hash (or a token of a
 * different push type) -> null (cached negative); a disabled instance, or one
 * without a `metrics` binding -> a revoked row; an enabled `metrics`-bound
 * instance -> a row whose `resourceId` is the bound stream id and whose `tokenId`
 * is the source id.
 */

import {
  createPushTokenLookup,
  type PushTokenVerifier,
} from "@checkstack/telemetry-backend";
import type { IngestTokenLookup } from "@checkstack/ingest-utils";
import { METRICSTREAM_PUSH_QUALIFIED_ID } from "../sources/push/source-type";

/**
 * Build the ingest-token lookup for metricstream push tokens, backed by the
 * platform verifier. Feed the returned lookup to `createIngestAuthenticator`.
 */
export function createMetricstreamPushTokenLookup({
  verifier,
}: {
  verifier: PushTokenVerifier;
}): IngestTokenLookup {
  return createPushTokenLookup({
    verifier,
    sourceTypeId: METRICSTREAM_PUSH_QUALIFIED_ID,
    signal: "metrics",
  });
}
