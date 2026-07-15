import { resolveRoute } from "@checkstack/common";
import type { AccessRule, IconName } from "@checkstack/common";
import type {
  SystemSignal,
  SystemSignalsMap,
  SystemSignalTone,
} from "@checkstack/catalog-common";
import type { LinkedStreamStatus } from "@checkstack/telemetry-common";
import { tracestreamRoutes } from "@checkstack/tracestream-common";

/** Stable id for tracestream's dashboard signal contribution (dedup key). */
export const TRACESTREAM_SIGNAL_SOURCE_ID = "tracestream";

/**
 * The ONLY important-event type tracestream turns into a dashboard signal, and
 * its tone/label/icon. `error_spike` (a surge of error spans) is a genuine
 * attention event.
 *
 * `silence` is deliberately NOT surfaced here: silence is already the
 * tracestream HEALTH strategy's job (it drives the system's health status), so
 * surfacing it as a signal too would DOUBLE-report a silent stream (logstream
 * and metricstream document the identical decision). Keeping the set to the one
 * clearly-bad type keeps the dashboard high-signal. The set mirrors
 * `TRACESTREAM_SIGNAL_EVENT_TYPES`, which the backend status query filters on,
 * so a non-signal event can never mask the spike.
 */
const SIGNAL_BY_EVENT: Record<
  string,
  { tone: SystemSignalTone; label: string; iconName: IconName }
> = {
  error_spike: {
    tone: "error",
    label: "Trace error spike",
    iconName: "TriangleAlert",
  },
};

/**
 * Derive per-system dashboard signals from the bulk linked-stream statuses.
 * Pure so the filler and its unit test share one transform. A stream may link
 * several systems, so its signal is attributed to EACH of its `systemIds`; a
 * stream with no recent (or non-signal) event contributes nothing, leaving a
 * healthy system simply absent from the map.
 */
export function deriveTraceStreamSignals({
  matches,
  accessRule,
}: {
  matches: readonly LinkedStreamStatus[];
  accessRule: AccessRule;
}): SystemSignalsMap {
  const out: SystemSignalsMap = {};
  for (const match of matches) {
    const event = match.lastImportantEvent;
    if (!event) continue;
    const mapped = SIGNAL_BY_EVENT[event.type];
    if (!mapped) continue;
    const signal: SystemSignal = {
      source: TRACESTREAM_SIGNAL_SOURCE_ID,
      tone: mapped.tone,
      label: mapped.label,
      detail: match.name,
      href: resolveRoute(tracestreamRoutes.routes.detail, {
        streamId: match.id,
      }),
      // The stream detail page is read-gated; render as text for users without it.
      accessRule,
      since: new Date(event.ts).toISOString(),
      iconName: mapped.iconName,
    };
    for (const systemId of match.systemIds) {
      (out[systemId] ??= []).push(signal);
    }
  }
  return out;
}
