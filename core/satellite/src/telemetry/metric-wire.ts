/**
 * Agent-side adapter over the SHARED metricstream forward wire contracts. The
 * schemas + kind constants live in `@checkstack/metricstream-common` (owned by
 * the metricstream plugin, imported by both the core handlers and this agent);
 * this module re-exports the FORWARD-batch contract (the agent's HTTP/OTLP metric
 * receivers push into it) and adds the one helper the agent needs that the core
 * direction does not: serializing a parsed {@link NormalizedDatapoint} (Date
 * `ts`) to its wire shape (ISO `ts`). The core provides the inverse
 * (`wireDatapointToNormalized`).
 */

import {
  normalizedDatapointToWire,
  type NormalizedDatapoint,
  type WireDatapoint,
} from "@checkstack/metricstream-common";

// The metricstream forward contract - kind constant, forward batch, WireDatapoint
// - is owned by the shared leaf and validated on BOTH ends against ONE schema.
export {
  METRICSTREAM_TELEMETRY_KIND,
  MetricstreamForwardBatchSchema,
  wireDatapointToNormalized,
  type WireDatapoint,
  type MetricstreamForwardBatch,
} from "@checkstack/metricstream-common";

/**
 * Serialize a {@link NormalizedDatapoint} to the shared wire shape (ts -> ISO,
 * including each exemplar's own ts). Delegates to the shared leaf's
 * `normalizedDatapointToWire` so serialize/deserialize stay in lock-step.
 */
export function toWireDatapoint(dp: NormalizedDatapoint): WireDatapoint {
  return normalizedDatapointToWire(dp);
}
