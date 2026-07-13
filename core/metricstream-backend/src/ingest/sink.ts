import { IngestBuffer, type FlushLoop } from "@checkstack/ingest-utils";
import type { NormalizedDatapoint } from "@checkstack/metricstream-common";
import type {
  MetricIngestSink,
  IngestSinkResult,
} from "../sources/extension-point";
import { clampDatapointTs } from "@checkstack/metricstream-common";

/** A buffered datapoint tagged with its owning stream (the buffer's item type). */
export interface BufferedDatapoint {
  streamId: string;
  datapoint: NormalizedDatapoint;
}

/**
 * Approximate the heap bytes a buffered datapoint occupies, so the buffer's byte
 * budget (the OOM guard) is meaningful. Rough but monotonic in the payload size:
 * the name + each label key/value + a fixed per-row overhead for the numbers and
 * object headers.
 */
export function estimateDatapointBytes(item: BufferedDatapoint): number {
  let bytes = 48 + item.streamId.length + item.datapoint.name.length;
  for (const [key, value] of Object.entries(item.datapoint.labels)) {
    bytes += key.length + value.length + 8;
  }
  return bytes;
}

/**
 * The shared ingest sink: normalize -> buffer (fair-share, byte-capped) -> flush
 * loop. Both push and pull sources write here. The sink OWNS the per-pod buffer
 * and triggers a size-based flush; the actual drain -> fold -> persist is the
 * injected `runCycle` on the {@link FlushLoop} (wired in `registerIngest`).
 *
 * STATE & SCALE: the buffer is a short-lived pod-local write buffer, never a
 * queryable source of truth. Each pod buffers and flushes its own intake; the
 * durable record is the flush's Postgres writes.
 */
export function createMetricSink({
  buffer,
  flushLoop,
  flushThreshold,
}: {
  buffer: IngestBuffer<BufferedDatapoint>;
  flushLoop: FlushLoop;
  /** Trigger a flush once the buffer holds at least this many datapoints. */
  flushThreshold: number;
}): MetricIngestSink {
  return {
    ingest({ streamId, datapoints, now }): IngestSinkResult {
      if (datapoints.length === 0) return { accepted: 0, rejected: 0 };
      // Clamp every datapoint's ts into the trust window HERE - the one place
      // both push and pull sources funnel through - so no source parser can let
      // an out-of-range timestamp reach a bucket (see clamp.ts). Mutates the
      // transient parser output in place; cheap and authoritative.
      const observedAt = now ?? new Date();
      for (const datapoint of datapoints) {
        datapoint.ts = clampDatapointTs({ ts: datapoint.ts, observedAt });
      }
      const items = datapoints.map((datapoint) => ({ streamId, datapoint }));
      const { accepted, rejected } = buffer.push({ key: streamId, items });
      if (buffer.size >= flushThreshold) {
        void flushLoop.flushNow();
      }
      return { accepted, rejected };
    },
  };
}
