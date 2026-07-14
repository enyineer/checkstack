/**
 * Shared identifiers for the trace-stream health-check integration. Kept here
 * (a leaf common package) so the BACKEND that registers the strategy /
 * annotates the config schemas and the FRONTEND that supplies the dropdown
 * resolvers reference one string each, never two that can silently drift
 * apart.
 */

/**
 * The (unqualified) id of the `tracestream` health-check strategy, as
 * registered with the backend `healthCheckRegistry` and surfaced in the check
 * editor. The frontend keys its dropdown-resolver contribution on this.
 */
export const TRACESTREAM_STRATEGY_ID = "tracestream";

/** Stream picker for the `tracestream` strategy's `streamId` config field. */
export const TRACESTREAM_STREAM_OPTIONS_RESOLVER = "tracestreamStreamId";

/**
 * Service picker for the `operation-latency` collector's `serviceName` field.
 * The options are the service catalog of the stream chosen in the strategy
 * form.
 */
export const TRACESTREAM_SERVICE_OPTIONS_RESOLVER = "tracestreamServiceName";

/**
 * Operation (span name) picker for the `operation-latency` collector's
 * `spanName` field. The options are the operations of the service chosen in
 * the SAME collector form (the resolver reads `serviceName` from the
 * collector's own `formValues`).
 */
export const TRACESTREAM_OPERATION_OPTIONS_RESOLVER = "tracestreamSpanName";
