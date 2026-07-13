import { z } from "zod";
import {
  NormalizedDatapointSchema,
  type NormalizedDatapoint,
} from "../schemas";

/**
 * Shared wire contracts for the two metricstream satellite capability kinds.
 * Both the CORE handlers (metricstream-backend) and the AGENT (core/satellite)
 * import these so the batch / config / status payloads are validated with ONE
 * schema on both ends. The payloads ride the generic `telemetry_batch`,
 * `capability_config` and `capability_status` envelopes owned by
 * satellite-backend; each kind's payload is opaque to the platform and parsed
 * here.
 *
 * Two kinds:
 * - {@link METRICSTREAM_TELEMETRY_KIND} ("metricstream"): a satellite receiver
 *   FORWARDS push telemetry it accepted for a stream. Authorized end to end by
 *   the stream's `ckms_` source token (verified on core, exactly like the HTTP
 *   push path).
 * - {@link METRIC_SCRAPE_CAPABILITY_KIND} ("metric-scrape"): the satellite
 *   SCRAPES a bound target and forwards the datapoints. Authorized by the target
 *   BINDING (core validates the target belongs to the sending satellite); no
 *   token is minted for scrapes.
 */

/** Capability kind for forwarded push telemetry (token-authorized). */
export const METRICSTREAM_TELEMETRY_KIND = "metricstream";
/** Capability kind for satellite-scraped targets (binding-authorized). */
export const METRIC_SCRAPE_CAPABILITY_KIND = "metric-scrape";

/**
 * A datapoint as it travels over the WS channel: identical to
 * {@link NormalizedDatapointSchema} except `ts` is an ISO-8601 STRING (JSON has
 * no Date type). The agent produces these with the SHARED parsers and serializes
 * the timestamp; the core handler converts back to a `Date` with
 * {@link wireDatapointToNormalized} before feeding the sink.
 */
export const WireDatapointSchema = NormalizedDatapointSchema.extend({
  ts: z.string(),
});
export type WireDatapoint = z.infer<typeof WireDatapointSchema>;

/** Convert a wire datapoint (ISO `ts`) to a {@link NormalizedDatapoint} (Date `ts`). */
export function wireDatapointToNormalized(dp: WireDatapoint): NormalizedDatapoint {
  return { ...dp, ts: new Date(dp.ts) };
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

// =============================================================================
// kind "metric-scrape" - satellite-side scraping
// =============================================================================

/**
 * One target entry in the `capability_config` pushed to a satellite. Carries
 * everything the agent's scrape scheduler needs to poll the target EXCEPT the
 * bearer secret: the config re-crosses the wire on every reconnect, so per the
 * platform invariant it NEVER carries a secret. `hasBearer` is an advisory flag
 * telling the agent the target is bearer-authenticated; the agent then fetches
 * the token just-in-time via a `capability_secret_request`
 * ({@link MetricScrapeSecretRequestSchema}) right before scraping and holds it
 * in memory only for the scrape interval. See {@link MetricScrapeSecretResponseSchema}.
 */
export const MetricScrapeTargetConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  intervalSeconds: z.number().int(),
  timeoutMs: z.number().int(),
  /** Max series the agent may forward from one scrape (the stream's seriesCap). */
  maxSeries: z.number().int(),
  /**
   * True when the target is bearer-authenticated: the agent must fetch the token
   * JIT via a `capability_secret_request` before scraping. NO plaintext secret
   * ever rides this config.
   */
  hasBearer: z.boolean(),
});
export type MetricScrapeTargetConfig = z.infer<
  typeof MetricScrapeTargetConfigSchema
>;

/**
 * `capability_secret_request` payload for kind "metric-scrape": the agent names
 * the bound target whose bearer it needs. Core validates the target is bound to
 * the requesting satellite (binding IS the authorization) before resolving.
 */
export const MetricScrapeSecretRequestSchema = z.object({
  targetId: z.string(),
});
export type MetricScrapeSecretRequest = z.infer<
  typeof MetricScrapeSecretRequestSchema
>;

/**
 * `capability_secret_response` payload for kind "metric-scrape": the resolved
 * bearer token, or omitted when the target has no bearer configured (the agent
 * then scrapes without an Authorization header). A resolution/binding failure is
 * signaled by the envelope's `error`, not by this payload.
 */
export const MetricScrapeSecretResponseSchema = z.object({
  bearerToken: z.string().optional(),
});
export type MetricScrapeSecretResponse = z.infer<
  typeof MetricScrapeSecretResponseSchema
>;

/**
 * `capability_config` payload for kind "metric-scrape": the full set of targets
 * this satellite should scrape. The agent REPLACES its scrape set with this
 * list, so an empty array means "scrape nothing" (a de-bound / deleted target
 * converges to removal).
 */
export const MetricScrapeConfigSchema = z.object({
  targets: z.array(MetricScrapeTargetConfigSchema),
});
export type MetricScrapeConfig = z.infer<typeof MetricScrapeConfigSchema>;

/**
 * `telemetry_batch` payload for kind "metric-scrape": one entry per scraped
 * target with its datapoints. Core validates each target's BINDING to the
 * sending satellite before feeding the sink (binding IS the authorization).
 */
export const MetricScrapeBatchSchema = z.array(
  z.object({
    targetId: z.string(),
    datapoints: z.array(WireDatapointSchema),
  }),
);
export type MetricScrapeBatch = z.infer<typeof MetricScrapeBatchSchema>;

/**
 * `capability_status` payload for kind "metric-scrape": per-target scrape health
 * the agent reports fire-and-forget. `lastScrapeAt` is an ISO string (or null
 * when never scraped); `consecutiveFailures` is ABSOLUTE (the agent owns the
 * counter since only it scrapes its bound targets) and optional for version
 * skew. Core mirrors these into the target row and fires the `scrape_failing`
 * event on the threshold crossing, reusing the core reconciler's semantics.
 */
export const MetricScrapeStatusSchema = z.array(
  z.object({
    targetId: z.string(),
    lastScrapeAt: z.string().nullable(),
    lastError: z.string().nullable(),
    consecutiveFailures: z.number().int().min(0).optional(),
  }),
);
export type MetricScrapeStatus = z.infer<typeof MetricScrapeStatusSchema>;
