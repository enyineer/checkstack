import type { ImportantEventType } from "./schemas";

/**
 * The important-event types logstream surfaces as dashboard "needs attention"
 * SIGNALS (via `SystemSignalsSlot`). A log `spike` (a surge of error/warn lines)
 * is a genuine attention event. `silence` is deliberately excluded - it is
 * already the logstream HEALTH strategy's job (it drives the system's health
 * status), so surfacing it here too would double-report. `new_pattern` /
 * `threshold` / `silence_recovered` are informational timeline entries, not
 * attention signals.
 *
 * SINGLE SOURCE OF TRUTH shared by the BACKEND status query and the FRONTEND
 * deriver, so the two can never drift:
 * - `listLinkedStreamStatuses` constrains its newest-important-event lookup to
 *   these types, so a newer NON-signal event (e.g. a `new_pattern` minutes after
 *   a `spike`) can never MASK the spike the dashboard needs to surface.
 * - `deriveLogstreamSignals` maps the resulting event to a signal.
 */
export const LOGSTREAM_SIGNAL_EVENT_TYPES = [
  "spike",
] as const satisfies readonly ImportantEventType[];

export type LogstreamSignalEventType =
  (typeof LOGSTREAM_SIGNAL_EVENT_TYPES)[number];
