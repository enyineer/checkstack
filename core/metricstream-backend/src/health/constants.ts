/**
 * Intra-plugin constants for the metricstream health integration + maintenance.
 */

import { METRICSTREAM_STRATEGY_ID } from "@checkstack/metricstream-common";

/** The `metric-window` collector's (unqualified) id. */
export const METRIC_WINDOW_COLLECTOR_ID = "metric-window";

/** Fully-qualified id of the metricstream strategy (pluginId.strategyId). */
export const METRICSTREAM_QUALIFIED_STRATEGY_ID = `metricstream.${METRICSTREAM_STRATEGY_ID}`;

/** Fully-qualified id of the metric-window collector. */
export const METRIC_WINDOW_QUALIFIED_COLLECTOR_ID = `metricstream.${METRIC_WINDOW_COLLECTOR_ID}`;

/** The plugin's own maintenance queue (rollup + retention + silence jobs). */
export const METRICSTREAM_MAINTENANCE_QUEUE = "metricstream-maintenance";
