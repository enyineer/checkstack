import { z } from "zod";
import {
  MAX_EXEMPLARS_PER_POINT,
  MetricExemplarSchema,
} from "@checkstack/telemetry-common";
import {
  NormalizedDatapointSchema,
  type NormalizedDatapoint,
} from "../schemas";

/**
 * Shared wire contract for the metricstream FORWARD satellite capability kind
 * ("metricstream"): a satellite receiver FORWARDS push telemetry it accepted for
 * a stream over the WS channel. Both the CORE handler (metricstream-backend) and
 * the AGENT (core/satellite) import these so the batch payload is validated with
 * ONE schema on both ends. The payload rides the generic `telemetry_batch`
 * envelope owned by satellite-backend; the payload is opaque to the platform and
 * parsed here.
 *
 * NOTE: the "metric-scrape" satellite capability is GONE - Prometheus scraping is
 * now a telemetry-platform PULL source type ("metricstream.prometheus-scrape"),
 * executed on the edge via the generic `telemetry-pull` capability (see
 * telemetry-common's `satellite/pull-capability.ts`). Only the push-forward
 * capability remains bespoke to metricstream.
 */

/** Capability kind for forwarded push telemetry (token-authorized). */
export const METRICSTREAM_TELEMETRY_KIND = "metricstream";

/**
 * An exemplar as it travels over the WS channel: identical to
 * {@link MetricExemplarSchema} except its own `ts` is an ISO-8601 STRING - JSON
 * has no Date type, so the exemplar timestamp needs the SAME string treatment as
 * the datapoint's `ts`, or the core-side parse rejects it.
 */
export const WireExemplarSchema = MetricExemplarSchema.extend({
  ts: z.string(),
});
export type WireExemplar = z.infer<typeof WireExemplarSchema>;

/**
 * A datapoint as it travels over the WS channel: identical to
 * {@link NormalizedDatapointSchema} except `ts` (and each exemplar's own `ts`)
 * is an ISO-8601 STRING (JSON has no Date type). The agent produces these with
 * the SHARED parsers and serializes the timestamps; the core handler converts
 * both back to `Date`s with {@link wireDatapointToNormalized} before feeding the
 * sink.
 */
export const WireDatapointSchema = NormalizedDatapointSchema.extend({
  ts: z.string(),
  exemplars: z
    .array(WireExemplarSchema)
    .max(MAX_EXEMPLARS_PER_POINT)
    .optional(),
});
export type WireDatapoint = z.infer<typeof WireDatapointSchema>;

/**
 * Convert a wire datapoint (ISO `ts`, ISO exemplar `ts`) to a
 * {@link NormalizedDatapoint} (Date `ts`). Exemplar timestamps are converted
 * one-for-one so a chart-to-trace jump-off survives the satellite hop.
 */
export function wireDatapointToNormalized(dp: WireDatapoint): NormalizedDatapoint {
  const { exemplars, ...rest } = dp;
  return {
    ...rest,
    ts: new Date(dp.ts),
    ...(exemplars
      ? { exemplars: exemplars.map((e) => ({ ...e, ts: new Date(e.ts) })) }
      : {}),
  };
}

/**
 * Serialize a {@link NormalizedDatapoint} (Date `ts`) to a {@link WireDatapoint}
 * (ISO `ts`, ISO exemplar `ts`) - the INVERSE of {@link wireDatapointToNormalized}
 * used by the satellite agent before it forwards a batch. Exemplar timestamps are
 * serialized one-for-one so the jump-off survives the hop.
 */
export function normalizedDatapointToWire(dp: NormalizedDatapoint): WireDatapoint {
  const { exemplars, ...rest } = dp;
  return {
    ...rest,
    ts: dp.ts.toISOString(),
    ...(exemplars
      ? { exemplars: exemplars.map((e) => ({ ...e, ts: e.ts.toISOString() })) }
      : {}),
  };
}

// =============================================================================
// kind "metricstream" - forwarded push telemetry
// =============================================================================

/**
 * `telemetry_batch` payload for kind "metricstream": an ARRAY of per-token
 * groups. A receiver may forward telemetry for multiple streams in one batch, so
 * each item carries its own `ckms_` stream token plus the parsed datapoints. Core
 * verifies each token (revocation intact) and resolves the streamId, exactly like
 * the HTTP push endpoint.
 */
export const MetricstreamForwardBatchSchema = z.array(
  z.object({
    /** The `ckms_` source token the receiver was handed by the shipper. */
    streamToken: z.string().min(1),
    datapoints: z.array(WireDatapointSchema),
  }),
);
export type MetricstreamForwardBatch = z.infer<
  typeof MetricstreamForwardBatchSchema
>;
