/**
 * Agent-side adapter over the SHARED tracestream satellite wire contract. The
 * schemas + serializers live in `@checkstack/tracestream-common` (owned by the
 * tracestream plugin, imported by both the core handler and this agent); this
 * module re-exports the one serializer the agent needs (`toWireSpan`) and the
 * per-token batch-item type, and fixes the telemetry KIND string the agent tags
 * each forwarded trace batch with.
 *
 * Unlike metricstream (whose kind constant lives in its common leaf), tracestream
 * mirrors the logstream pattern: the kind string is declared independently on
 * BOTH ends (`TRACESTREAM_TELEMETRY_KIND` here, `TRACESTREAM_CAPABILITY_KIND` in
 * `tracestream-backend`) and they agree by value ("tracestream"). The wire SHAPE
 * is the single shared schema, so the two ends can never disagree on the payload.
 */

export {
  toWireSpan,
  type SatelliteSpan,
  type SatelliteTraceBatchItem,
} from "@checkstack/tracestream-common";

/** The telemetry kind the agent tags forwarded trace batches with. */
export const TRACESTREAM_TELEMETRY_KIND = "tracestream";
