import type { NormalizedLogRecord } from "@checkstack/telemetry-common";
import type { K8sEvent } from "./k8s-event";

/**
 * Map a verified `events.k8s.io/v1` Event to a normalized log record.
 *
 * TIMESTAMP PRECEDENCE (documented deviation from the task's initial hint, which
 * listed `eventTime` first): we take `series.lastObservedTime` FIRST when the
 * event is an aggregated series, because that is the MOST RECENT observation -
 * the right value both for a log-of-events stream and for the client-side window
 * that approximates "new events since the last pull". A long-running repeating
 * event keeps `eventTime` at its first occurrence while `lastObservedTime`
 * advances; windowing on `eventTime` would stop emitting the ongoing
 * recurrences. Fallbacks then cover events synthesized from the legacy core/v1
 * shape (`deprecatedLastTimestamp`) and, last, the object creation time.
 *
 *   series.lastObservedTime -> eventTime -> deprecatedLastTimestamp
 *     -> metadata.creationTimestamp
 */
export function effectiveEventTimestamp(event: K8sEvent): Date | null {
  const raw =
    event.series?.lastObservedTime ??
    event.eventTime ??
    event.deprecatedLastTimestamp ??
    event.metadata?.creationTimestamp ??
    null;
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** OTel severity numbers used for the two Kubernetes event types. */
export const K8S_EVENT_SEVERITY_INFO = 9; // INFO
export const K8S_EVENT_SEVERITY_WARN = 13; // WARN

/**
 * Map the Event `type` to an OTel severity. Only "Warning" is elevated; every
 * other value (canonically "Normal") maps to info. The original text is
 * preserved in `severityText`.
 */
export function eventSeverity(type: string | undefined): {
  severityNumber: number;
  severityText: string;
} {
  if (type === "Warning") {
    return { severityNumber: K8S_EVENT_SEVERITY_WARN, severityText: "Warning" };
  }
  return {
    severityNumber: K8S_EVENT_SEVERITY_INFO,
    severityText: type ?? "Normal",
  };
}

/** Compose the log body from the machine reason and the human note. */
function composeBody(event: K8sEvent): string {
  const reason = event.reason?.trim();
  const note = event.note?.trim();
  if (reason && note) return `${reason}: ${note}`;
  return note ?? reason ?? "(kubernetes event)";
}

/** Drop undefined/null values so attributes stay compact. */
function defined<T>(
  entries: Array<[string, T | undefined | null]>,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [key, value] of entries) {
    if (value !== undefined && value !== null) out[key] = value;
  }
  return out;
}

/**
 * Convert one Event into a normalized log record, or `null` when it carries no
 * usable timestamp (an event that cannot be windowed reliably is skipped and
 * counted by the caller). Resource `serviceName` is intentionally left unset -
 * the involved object's identity is carried in attributes.
 */
export function eventToLogRecord(event: K8sEvent): NormalizedLogRecord | null {
  const ts = effectiveEventTimestamp(event);
  if (!ts) return null;

  const { severityNumber, severityText } = eventSeverity(event.type);
  const namespace = event.regarding?.namespace ?? event.metadata?.namespace;

  const attributes = defined<unknown>([
    ["k8s.namespace.name", namespace],
    ["k8s.event.reason", event.reason],
    ["k8s.event.action", event.action],
    ["k8s.event.type", event.type],
    ["k8s.event.reporting_controller", event.reportingController],
    ["k8s.event.reporting_instance", event.reportingInstance],
    ["k8s.event.uid", event.metadata?.uid],
    ["k8s.event.name", event.metadata?.name],
    ["k8s.event.series_count", event.series?.count],
    ["k8s.event.deprecated_count", event.deprecatedCount],
    ["k8s.object.kind", event.regarding?.kind],
    ["k8s.object.name", event.regarding?.name],
    ["k8s.object.uid", event.regarding?.uid],
    ["k8s.object.api_version", event.regarding?.apiVersion],
    ["k8s.object.field_path", event.regarding?.fieldPath],
  ]);

  return {
    ts,
    severityNumber,
    severityText,
    body: composeBody(event),
    attributes,
  };
}
