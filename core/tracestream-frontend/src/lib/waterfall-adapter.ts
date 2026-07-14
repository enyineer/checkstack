import type { TraceSpan } from "@checkstack/tracestream-common";
import type { WaterfallSpan } from "@checkstack/ui";

/**
 * Map a stored `TraceSpan` (from `getTrace`) onto the UI kit's `WaterfallSpan`.
 * Centralizes the one coupling point between the domain span shape and the
 * chart component, so a contract field rename surfaces here rather than in the
 * component. `statusCode` and `kind` pass through unchanged (the contract reuses
 * the telemetry status/kind enums the waterfall expects).
 */
export function toWaterfallSpan(span: TraceSpan): WaterfallSpan {
  return {
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    name: span.name,
    serviceName: span.serviceName,
    kind: span.kind,
    startTs: span.startTs,
    durationMs: span.durationMs,
    statusCode: span.statusCode,
  };
}

/** Map a whole trace's spans for the waterfall. */
export function toWaterfallSpans(
  spans: ReadonlyArray<TraceSpan>,
): WaterfallSpan[] {
  return spans.map((s) => toWaterfallSpan(s));
}
