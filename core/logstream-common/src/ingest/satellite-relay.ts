/**
 * Wire contract for logs forwarded THROUGH a satellite (the "logstream"
 * telemetry capability). Shared leaf so both sides use one shape:
 *
 * - the satellite AGENT parses raw shipper input to {@link IngestedLine} with
 *   the shared parsers, then serializes each line with {@link toWireLogLine} and
 *   enqueues `{ streamToken, lines }` items on its telemetry client;
 * - the core LOGSTREAM handler validates the batch with
 *   {@link SatelliteLogBatchSchema}, verifies each `streamToken` with the
 *   existing ingest authenticator, re-clamps the timestamps against ITS OWN
 *   clock and feeds the resolved lines into the existing ingest pipeline.
 *
 * The two `IngestedLine` `Date` fields become ISO strings for JSON transport;
 * everything else is carried verbatim. The satellite never verifies the token
 * (it has no DB) - it forwards whatever a shipper presented and core decides.
 *
 * Pure module: no IO, no node builtins (only `zod` + type imports), keeping
 * `logstream-common` browser-safe.
 */

import { z } from "zod";
import { SeverityBandSchema, type IngestedLine } from "../schemas";

/**
 * One normalized log line on the wire. Identical to {@link IngestedLine} except
 * `ts` / `observedAt` are ISO-8601 strings. `severityText` is retained so the
 * core handler can re-apply a stream's `severityRules.valueMap` (which the
 * agent cannot, having no per-stream config).
 */
export const SatelliteLogLineSchema = z.object({
  ts: z.string(),
  observedAt: z.string(),
  severityNumber: z.number().int().min(0).max(24),
  severityText: z.string().optional(),
  band: SeverityBandSchema,
  body: z.string(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  resource: z.record(z.string(), z.unknown()).optional(),
  traceId: z.string().optional(),
  spanId: z.string().optional(),
});
export type SatelliteLogLine = z.infer<typeof SatelliteLogLineSchema>;

/**
 * One item of a "logstream" telemetry batch: the raw `ckls_` source token the
 * shipper presented (forwarded verbatim; core verifies + resolves the stream)
 * and the normalized lines authorized by it.
 */
export const SatelliteLogBatchItemSchema = z.object({
  streamToken: z.string(),
  lines: z.array(SatelliteLogLineSchema),
});
export type SatelliteLogBatchItem = z.infer<typeof SatelliteLogBatchItemSchema>;

/** The whole "logstream" telemetry batch payload: an array of per-token items. */
export const SatelliteLogBatchSchema = z.array(SatelliteLogBatchItemSchema);

/** Serialize a parsed {@link IngestedLine} to its wire shape (Dates -> ISO). */
export function toWireLogLine(line: IngestedLine): SatelliteLogLine {
  return {
    ts: line.ts.toISOString(),
    observedAt: line.observedAt.toISOString(),
    severityNumber: line.severityNumber,
    ...(line.severityText === undefined
      ? {}
      : { severityText: line.severityText }),
    band: line.band,
    body: line.body,
    ...(line.attributes === undefined ? {} : { attributes: line.attributes }),
    ...(line.resource === undefined ? {} : { resource: line.resource }),
    ...(line.traceId === undefined ? {} : { traceId: line.traceId }),
    ...(line.spanId === undefined ? {} : { spanId: line.spanId }),
  };
}
