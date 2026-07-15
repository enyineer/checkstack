import type { ImportantEventType } from "./schemas";

/**
 * The important-event types tracestream surfaces as dashboard "needs attention"
 * SIGNALS (via `SystemSignalsSlot`). An `error_spike` (a surge of error spans)
 * is a genuine attention event. `silence` is deliberately excluded - it is
 * already the tracestream HEALTH strategy's job (it drives the system's health
 * status), so surfacing it here too would double-report. Rate-limit / cap /
 * recovery events are informational timeline entries, not attention signals.
 *
 * SINGLE SOURCE OF TRUTH shared by the BACKEND status query and the FRONTEND
 * deriver, so the two can never drift:
 * - `listLinkedStreamStatuses` constrains its newest-important-event lookup to
 *   these types, so a newer NON-signal event (e.g. a `rate_limited` minutes
 *   after an `error_spike`) can never MASK the spike the dashboard must surface.
 * - `deriveTraceStreamSignals` maps the resulting event to a signal.
 */
export const TRACESTREAM_SIGNAL_EVENT_TYPES = [
  "error_spike",
] as const satisfies readonly ImportantEventType[];

export type TracestreamSignalEventType =
  (typeof TRACESTREAM_SIGNAL_EVENT_TYPES)[number];
