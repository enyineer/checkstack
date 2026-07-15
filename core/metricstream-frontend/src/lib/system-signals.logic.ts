import { resolveRoute } from "@checkstack/common";
import type {
  SystemSignal,
  SystemSignalTone,
  SystemSignalsMap,
} from "@checkstack/catalog-common";
import type { LinkedStreamStatus } from "@checkstack/telemetry-common";
import {
  metricstreamAccess,
  metricstreamRoutes,
  METRICSTREAM_SIGNAL_EVENT_TYPES,
  type MetricstreamSignalEventType,
} from "@checkstack/metricstream-common";

/**
 * Stable source id for metricstream-originated dashboard/system signals.
 * Surfaced as `source` on every emitted {@link SystemSignal}; re-reporting with
 * the same id REPLACES this source's previous contribution.
 */
export const METRICSTREAM_SIGNAL_SOURCE_ID = "metricstream";

/**
 * Tone + label for each signal-worthy event type. The KEY SET is enforced (via
 * `satisfies`) to be exactly {@link METRICSTREAM_SIGNAL_EVENT_TYPES} - the SAME
 * shared set the backend `listLinkedStreamStatuses` query filters on - so the
 * deriver and the query can never drift:
 *
 * - `scrape_failing` (error): a pull source cannot be scraped - a real
 *   collection failure the owner must act on.
 * - `series_cap` (warn): the stream hit its cardinality cap and is DROPPING
 *   series - a data-completeness degradation worth surfacing, but not an outage.
 *
 * `silence` / `silence_recovered` are NOT in the shared set: silence is already
 * the metricstream HEALTH strategy's job (it drives the system's health status),
 * and a recovery is not an attention signal.
 */
const SIGNAL_EVENT_TONES = {
  scrape_failing: "error",
  series_cap: "warn",
} satisfies Record<MetricstreamSignalEventType, SystemSignalTone>;

/** Short label per surfaced event type (same enforced key set). */
const SIGNAL_EVENT_LABELS = {
  scrape_failing: "Metric scrape failing",
  series_cap: "Metric cardinality cap hit",
} satisfies Record<MetricstreamSignalEventType, string>;

/** Type guard against the shared signal-worthy set. */
function isSignalEventType(type: string): type is MetricstreamSignalEventType {
  return (METRICSTREAM_SIGNAL_EVENT_TYPES as readonly string[]).includes(type);
}

/**
 * Pure deriver shared by the frontend `SystemSignalsSlot` filler (and unit
 * tests). Given the linked-stream statuses for the requested systems, emit one
 * signal per linked stream whose newest recent important event is a clearly-bad
 * type, keyed by each system the stream is linked to. Systems with no such
 * linked stream are omitted (healthy as far as this source is concerned).
 */
export function deriveMetricstreamSignals({
  statuses,
}: {
  /** The `matches` from `listLinkedStreamStatuses`. */
  statuses: readonly LinkedStreamStatus[];
}): SystemSignalsMap {
  const result: SystemSignalsMap = {};
  for (const status of statuses) {
    const event = status.lastImportantEvent;
    if (!event || !isSignalEventType(event.type)) continue;

    const signal: SystemSignal = {
      source: METRICSTREAM_SIGNAL_SOURCE_ID,
      tone: SIGNAL_EVENT_TONES[event.type],
      label: SIGNAL_EVENT_LABELS[event.type],
      detail: status.name,
      href: resolveRoute(metricstreamRoutes.routes.detail, {
        streamId: status.id,
      }),
      // The stream detail page is read-gated; render as text for users without it.
      accessRule: metricstreamAccess.read,
      since: new Date(event.ts).toISOString(),
      iconName: "Gauge",
    };

    for (const systemId of status.systemIds) {
      (result[systemId] ??= []).push(signal);
    }
  }
  return result;
}
