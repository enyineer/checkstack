/**
 * Shared identifiers for the metric-stream health-check integration. Kept here
 * (a leaf common package) so the BACKEND that registers the strategy / annotates
 * the config schemas and the FRONTEND that supplies the dropdown resolvers
 * reference one string each, never two that can silently drift apart.
 */

/**
 * The (unqualified) id of the `metricstream` health-check strategy, as
 * registered with the backend `healthCheckRegistry` and surfaced in the check
 * editor. The frontend keys its dropdown-resolver contribution on this.
 */
export const METRICSTREAM_STRATEGY_ID = "metricstream";

/** Stream picker for the `metricstream` strategy's `streamId` config field. */
export const METRICSTREAM_STREAM_OPTIONS_RESOLVER = "metricstreamStreamId";

/**
 * Metric-name picker for the `metric-window` collector's `metricName` field.
 * The options are the metric names of the stream chosen in the strategy form.
 * Rendered as a SEARCHABLE dropdown (`x-searchable`), since a stream can carry
 * many metric names.
 */
export const METRICSTREAM_METRIC_NAME_OPTIONS_RESOLVER =
  "metricstreamMetricName";

/**
 * Label-KEY picker for a `metric-window` collector `labelFilters[].key` field.
 * Options are the DISTINCT label keys of the metric chosen in the SAME collector
 * form (the resolver reads `metricName` from the collector's `formValues`).
 */
export const METRICSTREAM_LABEL_KEY_OPTIONS_RESOLVER = "metricstreamLabelKey";

/**
 * Label-VALUE picker for a `metric-window` collector `labelFilters[].value`
 * field. Options are the DISTINCT values for a `(metricName, key)` pair. The
 * resolver reads `metricName` AND the row's own `key` from `formValues` - which
 * requires the DynamicForm row-scoped-formValues capability (an array item's
 * resolver sees its own row's siblings merged over the whole-form values). See
 * the UI investigation decision in the metricstream plan.
 */
export const METRICSTREAM_LABEL_VALUE_OPTIONS_RESOLVER =
  "metricstreamLabelValue";
