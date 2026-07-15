import { resolveRoute } from "@checkstack/common";
import type {
  SystemSignal,
  SystemSignalsMap,
} from "@checkstack/catalog-common";
import type { LinkedStreamStatus } from "@checkstack/telemetry-common";
import { logstreamAccess, logstreamRoutes } from "@checkstack/logstream-common";

/**
 * Stable source id for logstream-originated dashboard/system signals. Surfaced
 * as `source` on every emitted {@link SystemSignal}; re-reporting with the same
 * id REPLACES this source's previous contribution.
 */
export const LOGSTREAM_SIGNAL_SOURCE_ID = "logstream";

/**
 * The ONLY important-event type logstream turns into a dashboard signal. A log
 * `spike` (a sudden surge of error/warn lines) is a genuine "needs attention"
 * event. `silence` / `silence_recovered` / `new_pattern` / `threshold` are
 * deliberately NOT surfaced here: silence is already the logstream HEALTH
 * strategy's job (it drives the system's health status), and the rest are
 * informational timeline entries, not attention signals. Being conservative
 * keeps the dashboard's signal list high-signal.
 */
const SIGNAL_EVENT_TYPE = "spike";

/**
 * Pure deriver shared by the frontend `SystemSignalsSlot` filler (and unit
 * tests). Given the linked-stream statuses for the requested systems, emit one
 * error-tone signal per linked stream whose newest recent important event is a
 * log `spike`, keyed by each system the stream is linked to. Systems with no
 * spiking linked stream are omitted (healthy as far as this source is concerned).
 */
export function deriveLogstreamSignals({
  statuses,
}: {
  /** The `matches` from `listLinkedStreamStatuses`. */
  statuses: readonly LinkedStreamStatus[];
}): SystemSignalsMap {
  const result: SystemSignalsMap = {};
  for (const status of statuses) {
    const event = status.lastImportantEvent;
    if (!event || event.type !== SIGNAL_EVENT_TYPE) continue;

    const signal: SystemSignal = {
      source: LOGSTREAM_SIGNAL_SOURCE_ID,
      tone: "error",
      label: "Log error spike",
      detail: status.name,
      href: resolveRoute(logstreamRoutes.routes.detail, {
        streamId: status.id,
      }),
      // The stream detail page is read-gated; render as text for users without it.
      accessRule: logstreamAccess.read,
      since: new Date(event.ts).toISOString(),
      iconName: "ScrollText",
    };

    for (const systemId of status.systemIds) {
      (result[systemId] ??= []).push(signal);
    }
  }
  return result;
}
