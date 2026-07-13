/**
 * Agent-side adapter over the SHARED metricstream satellite wire contracts. The
 * schemas + kind constants live in `@checkstack/metricstream-common` (owned by
 * the metricstream plugin, imported by both the core handlers and this agent);
 * this module re-exports them and adds the one helper the agent needs that the
 * core direction does not: serializing a scraped/parsed {@link NormalizedDatapoint}
 * (Date `ts`) to its wire shape (ISO `ts`). The core provides the inverse
 * (`wireDatapointToNormalized`).
 */

import type {
  NormalizedDatapoint,
  WireDatapoint,
} from "@checkstack/metricstream-common";

// Every metricstream satellite contract - config, batch, status, secret
// request/response, WireDatapoint - is owned by the shared leaf and validated on
// BOTH ends against ONE schema. The agent parses the pushed config with the SAME
// MetricScrapeConfigSchema the core builds; a bearer NEVER rides that config
// (`hasBearer` is advisory), so the scheduler fetches it JIT via a
// `capability_secret_request` (see MetricScrapeSecret{Request,Response}Schema).
export {
  METRICSTREAM_TELEMETRY_KIND,
  METRIC_SCRAPE_CAPABILITY_KIND,
  MetricstreamForwardBatchSchema,
  MetricScrapeConfigSchema,
  MetricScrapeTargetConfigSchema,
  MetricScrapeSecretRequestSchema,
  MetricScrapeSecretResponseSchema,
  MetricScrapeBatchSchema,
  MetricScrapeStatusSchema,
  wireDatapointToNormalized,
  type WireDatapoint,
  type MetricstreamForwardBatch,
  type MetricScrapeConfig,
  type MetricScrapeTargetConfig,
  type MetricScrapeSecretRequest,
  type MetricScrapeSecretResponse,
  type MetricScrapeBatch,
  type MetricScrapeStatus,
} from "@checkstack/metricstream-common";

/** Serialize a {@link NormalizedDatapoint} to the shared wire shape (ts -> ISO). */
export function toWireDatapoint(dp: NormalizedDatapoint): WireDatapoint {
  return { ...dp, ts: dp.ts.toISOString() };
}
