import type { ImportantEventType } from "./schemas";

/**
 * The important-event types metricstream surfaces as dashboard "needs attention"
 * SIGNALS (via `SystemSignalsSlot`). `scrape_failing` (a pull source that cannot
 * be scraped) and `series_cap` (the stream is dropping series at its cardinality
 * cap) are genuine, clearly-bad attention events. `silence` is deliberately
 * excluded - it is already the metricstream HEALTH strategy's job (it drives the
 * system's health status), so surfacing it here too would double-report;
 * `silence_recovered` is a recovery, not an attention signal.
 *
 * SINGLE SOURCE OF TRUTH shared by the BACKEND status query and the FRONTEND
 * deriver, so the two can never drift:
 * - `listLinkedStreamStatuses` constrains its newest-important-event lookup to
 *   these types, so a newer NON-signal event (e.g. a `silence_recovered` minutes
 *   after a `scrape_failing`) can never MASK the failure the dashboard needs to
 *   surface.
 * - `deriveMetricstreamSignals` maps the resulting event to a signal (tone per
 *   type).
 */
export const METRICSTREAM_SIGNAL_EVENT_TYPES = [
  "scrape_failing",
  "series_cap",
] as const satisfies readonly ImportantEventType[];

export type MetricstreamSignalEventType =
  (typeof METRICSTREAM_SIGNAL_EVENT_TYPES)[number];
