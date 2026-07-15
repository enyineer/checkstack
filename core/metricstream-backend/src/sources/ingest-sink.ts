import type { NormalizedDatapoint } from "@checkstack/metricstream-common";

/**
 * The ONE metric ingest sink contract shared by every write path: the OTLP /
 * native push endpoints, the telemetry-platform "metrics" sink, and the
 * satellite forward handler all normalize their input into
 * {@link NormalizedDatapoint}s and hand them to this sink, which owns buffering +
 * the flush/fold loop (clamping, cardinality caps, rollups). Stateless and
 * multi-pod-safe.
 *
 * (Historically this file also declared a `MetricSourceType` extension point that
 * dogfooded the push/pull sources; Prometheus scraping is now a telemetry
 * platform source type, so only the sink contract remains here.)
 */

/** Result of one sink write - drives the ingest endpoint's 200/429/partial answer. */
export interface IngestSinkResult {
  /** Datapoints admitted into the buffer. */
  accepted: number;
  /** Datapoints refused because the per-pod buffer was full (=> 429). */
  rejected: number;
}

/**
 * The write path: normalize -> buffer -> flush -> fold. Stateless and
 * multi-pod-safe; the sink owns buffering + the flush loop.
 */
export interface MetricIngestSink {
  ingest(input: {
    streamId: string;
    datapoints: NormalizedDatapoint[];
    /** Platform receive time; defaults to now. Used to clamp datapoint ts. */
    now?: Date;
  }): IngestSinkResult;
}
