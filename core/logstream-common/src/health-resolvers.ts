/**
 * Shared identifiers for the log-stream health-check integration. Kept here (a
 * leaf common package) so the BACKEND that registers the strategy / annotates
 * the config schemas and the FRONTEND that supplies the dropdown resolvers
 * reference one string each, never two that can silently drift apart.
 */

/**
 * The (unqualified) id of the `logstream` health-check strategy, as registered
 * with the backend `healthCheckRegistry` and surfaced in the check editor. The
 * frontend keys its dropdown-resolver contribution on this.
 */
export const LOGSTREAM_STRATEGY_ID = "logstream";

/** Stream picker for the `logstream` strategy's `streamId` config field. */
export const LOGSTREAM_STREAM_OPTIONS_RESOLVER = "logstreamStreamId";

/**
 * Pattern picker for the `pattern-occurrence` collector's `patternId` field.
 * The options are the Drain patterns of the stream chosen in the strategy form.
 */
export const LOGSTREAM_PATTERN_OPTIONS_RESOLVER = "logstreamPatternId";

/**
 * Variable-index picker for the `pattern-metric` collector's `variableIndex`
 * field. The options are the `<*>` wildcard positions of the pattern chosen in
 * the SAME collector form (the resolver reads `patternId` from the collector's
 * own `formValues`), labeled with recent samples + whether they look numeric.
 */
export const LOGSTREAM_VARIABLE_OPTIONS_RESOLVER = "logstreamVariableIndex";
