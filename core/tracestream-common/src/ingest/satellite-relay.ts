/**
 * Wire contract for spans forwarded THROUGH a satellite (the "tracestream"
 * telemetry capability). Shared leaf so both sides use one shape:
 *
 * - the satellite AGENT parses raw exporter input to `NormalizedSpan`s with
 *   the shared parsers (`decodeExportTraceServiceRequest` /
 *   `parseOtlpTracesJson` / `parseNativeTraces`, which already enforce the
 *   per-span attribute/event/link caps), serializes each span with
 *   {@link toWireSpan} and enqueues `{ streamToken, spans }` items on its
 *   telemetry client;
 * - the core TRACESTREAM handler validates the batch with
 *   {@link SatelliteTraceBatchSchema}, verifies each `streamToken` with the
 *   existing ingest authenticator, rehydrates spans with {@link fromWireSpan},
 *   re-clamps their times against ITS OWN clock (`clampSpanTimes` - the agent
 *   clock is untrusted) and feeds them into the existing ingest pipeline.
 *
 * `Date` fields ride as ISO-8601 strings and the optional OTel nanosecond
 * timestamps as decimal strings (bigints do not survive JSON), so the
 * satellite path never degrades precision versus direct ingest. The satellite
 * never verifies the token (it has no DB) - it forwards whatever an exporter
 * presented and core decides.
 *
 * Pure module: no IO, no node builtins (only `zod` + telemetry-common
 * schemas), keeping `tracestream-common` browser-safe.
 */

import { z } from "zod";
import {
  NormalizedSpanLinkSchema,
  TelemetryResourceSchema,
  TelemetrySpanKindSchema,
  TelemetrySpanStatusCodeSchema,
  type NormalizedSpan,
} from "@checkstack/telemetry-common";
import {
  MAX_ATTRIBUTES_PER_SPAN,
  MAX_EVENTS_PER_SPAN,
  MAX_LINKS_PER_SPAN,
} from "./caps";

/** OTel unix-nano timestamp on the wire: a decimal string (bigint at rest). */
const UnixNanoWireSchema = z.string().regex(/^\d{1,20}$/);

// W3C ids in their CANONICAL stored form. The direct-ingest parsers emit
// lowercase hex; the wire schema must be exactly as strict, or a forwarded
// span gets a different (streamId, traceId, spanId) identity than the same
// span pushed directly - defeating the unique-index dedupe and the
// lowercase-keyed log correlation lookups.
const TraceIdWireSchema = z.string().regex(/^[0-9a-f]{32}$/);
const SpanIdWireSchema = z.string().regex(/^[0-9a-f]{16}$/);

/** Reject over-cap attribute maps (the parsers cap while decoding; the wire
 * schema must not be more permissive than the endpoints it reproduces). */
const cappedAttributes = z
  .record(z.string(), z.unknown())
  .refine((value) => Object.keys(value).length <= MAX_ATTRIBUTES_PER_SPAN, {
    message: `at most ${MAX_ATTRIBUTES_PER_SPAN} attributes per span`,
  });

/** A span event on the wire: `ts` as an ISO-8601 string. */
export const SatelliteSpanEventSchema = z.object({
  ts: z.iso.datetime(),
  name: z.string(),
  attributes: z.record(z.string(), z.unknown()).optional(),
});
export type SatelliteSpanEvent = z.infer<typeof SatelliteSpanEventSchema>;

/**
 * One normalized span on the wire. Identical to `NormalizedSpan` except
 * `startTs`/`endTs` (and event timestamps) are ISO-8601 strings and the
 * optional nanosecond timestamps are decimal strings.
 */
export const SatelliteSpanSchema = z.object({
  traceId: TraceIdWireSchema,
  spanId: SpanIdWireSchema,
  parentSpanId: SpanIdWireSchema.optional(),
  name: z.string().min(1),
  kind: TelemetrySpanKindSchema,
  startTs: z.iso.datetime(),
  endTs: z.iso.datetime(),
  startUnixNano: UnixNanoWireSchema.optional(),
  endUnixNano: UnixNanoWireSchema.optional(),
  status: z
    .object({
      code: TelemetrySpanStatusCodeSchema,
      message: z.string().optional(),
    })
    .optional(),
  attributes: cappedAttributes.optional(),
  events: z.array(SatelliteSpanEventSchema).max(MAX_EVENTS_PER_SPAN).optional(),
  links: z.array(NormalizedSpanLinkSchema).max(MAX_LINKS_PER_SPAN).optional(),
  resource: TelemetryResourceSchema.optional(),
});
export type SatelliteSpan = z.infer<typeof SatelliteSpanSchema>;

/**
 * One item of a "tracestream" telemetry batch: the raw `cktr_` source token
 * the exporter presented (forwarded verbatim; core verifies + resolves the
 * stream) and the normalized spans authorized by it.
 */
export const SatelliteTraceBatchItemSchema = z.object({
  streamToken: z.string(),
  spans: z.array(SatelliteSpanSchema),
});
export type SatelliteTraceBatchItem = z.infer<
  typeof SatelliteTraceBatchItemSchema
>;

/** The whole "tracestream" telemetry batch payload: per-token items. */
export const SatelliteTraceBatchSchema = z.array(SatelliteTraceBatchItemSchema);
export type SatelliteTraceBatch = z.infer<typeof SatelliteTraceBatchSchema>;

/** Serialize a parsed `NormalizedSpan` to its wire shape (Dates -> ISO,
 * bigints -> decimal strings). */
export function toWireSpan(span: NormalizedSpan): SatelliteSpan {
  return {
    traceId: span.traceId,
    spanId: span.spanId,
    ...(span.parentSpanId === undefined
      ? {}
      : { parentSpanId: span.parentSpanId }),
    name: span.name,
    kind: span.kind,
    startTs: span.startTs.toISOString(),
    endTs: span.endTs.toISOString(),
    ...(span.startUnixNano === undefined
      ? {}
      : { startUnixNano: span.startUnixNano.toString() }),
    ...(span.endUnixNano === undefined
      ? {}
      : { endUnixNano: span.endUnixNano.toString() }),
    ...(span.status === undefined ? {} : { status: span.status }),
    ...(span.attributes === undefined ? {} : { attributes: span.attributes }),
    ...(span.events === undefined
      ? {}
      : {
          events: span.events.map((event) => ({
            ts: event.ts.toISOString(),
            name: event.name,
            ...(event.attributes === undefined
              ? {}
              : { attributes: event.attributes }),
          })),
        }),
    ...(span.links === undefined ? {} : { links: span.links }),
    ...(span.resource === undefined ? {} : { resource: span.resource }),
  };
}

/**
 * Rehydrate a validated wire span to a `NormalizedSpan` (ISO -> Date, decimal
 * strings -> bigint). The caller MUST still re-clamp the times against its
 * own clock (`clampSpanTimes`) before storage - the agent clock is untrusted.
 */
export function fromWireSpan(wire: SatelliteSpan): NormalizedSpan {
  return {
    traceId: wire.traceId,
    spanId: wire.spanId,
    ...(wire.parentSpanId === undefined
      ? {}
      : { parentSpanId: wire.parentSpanId }),
    name: wire.name,
    kind: wire.kind,
    startTs: new Date(wire.startTs),
    endTs: new Date(wire.endTs),
    ...(wire.startUnixNano === undefined
      ? {}
      : { startUnixNano: BigInt(wire.startUnixNano) }),
    ...(wire.endUnixNano === undefined
      ? {}
      : { endUnixNano: BigInt(wire.endUnixNano) }),
    ...(wire.status === undefined ? {} : { status: wire.status }),
    ...(wire.attributes === undefined ? {} : { attributes: wire.attributes }),
    ...(wire.events === undefined
      ? {}
      : {
          events: wire.events.map((event) => ({
            ts: new Date(event.ts),
            name: event.name,
            ...(event.attributes === undefined
              ? {}
              : { attributes: event.attributes }),
          })),
        }),
    ...(wire.links === undefined ? {} : { links: wire.links }),
    ...(wire.resource === undefined ? {} : { resource: wire.resource }),
  };
}
