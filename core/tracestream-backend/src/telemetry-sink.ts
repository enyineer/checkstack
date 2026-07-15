/**
 * The tracestream contribution to the telemetry platform's SINK extension point.
 * A telemetry SOURCE (a pull poller, a vendor webhook) hands the platform
 * normalized {@link NormalizedSpan}s; the platform routes them to the stream's
 * owning plugin through this sink, exactly as a source-token push feeds the
 * OTLP/native HTTP endpoints.
 *
 * The sink NEVER re-implements ingest policy. A {@link NormalizedSpan} is the
 * IDENTICAL type the OTLP/native decoders produce, so the sink hands records
 * straight to the SAME {@link IngestPipeline} the push endpoints use - clamping,
 * byte/span/rate caps, buffering and folding all apply uniformly no matter how
 * the span entered the platform. A parity regression test asserts the sink and
 * the endpoints share that pipeline (no divergent normalization).
 *
 * WIRING: `index.ts` captures the telemetry sink extension-point handle in
 * register() and registers this factory's sink in init(), right after
 * `registerIngest` exposes the shared pipeline + config resolver.
 */

import { qualifyAccessRuleId } from "@checkstack/common";
import type { AuthService, Logger } from "@checkstack/backend-api";
import {
  pluginMetadata,
  tracestreamAccess,
  tracestreamResourceTypes,
} from "@checkstack/tracestream-common";
import type { NormalizedSpan } from "@checkstack/telemetry-common";
import {
  createStreamBindAuthorizer,
  type TelemetrySinkContribution,
  type TelemetrySinkWriteResult,
} from "@checkstack/telemetry-backend";
import type { IngestPipeline } from "./ingest/pipeline";
import type { StreamConfigResolver } from "./ingest/stream-config";

/** Resolve a stream's identity by id, or null when it does not exist. */
export type ResolveTraceStream = (
  streamId: string,
) => Promise<{ id: string; name: string } | null>;

/** Resolve many trace streams by id in one query (unknown ids map to null). */
export type ResolveTraceStreams = (
  streamIds: string[],
) => Promise<Record<string, { id: string; name: string } | null>>;

/** List every trace stream (id + name) for the binding picker. */
export type ListTraceStreams = () => Promise<{ id: string; name: string }[]>;

/**
 * Build the tracestream telemetry sink contribution. `resolveStream` looks the
 * stream up by id (existence + display name); `pipeline` + `configResolver` are
 * the shared ingest seams; `auth` evaluates team grants for
 * {@link TelemetrySinkContribution.assertBindable}.
 */
export function createTracestreamTelemetrySink({
  resolveStream,
  resolveStreams,
  listStreams,
  pipeline,
  configResolver,
  auth,
  logger,
}: {
  resolveStream: ResolveTraceStream;
  /** Batched resolver for list read paths; omit to fall back to per-id lookups. */
  resolveStreams?: ResolveTraceStreams;
  /** List all streams for the binding picker; omit to disable the picker. */
  listStreams?: ListTraceStreams;
  pipeline: IngestPipeline;
  configResolver: StreamConfigResolver;
  auth: Pick<AuthService, "check" | "listAccessibleObjectIds">;
  logger: Logger;
}): TelemetrySinkContribution<"traces"> {
  const { assertBindable, describeStream, describeStreams, listBindableStreams } =
    createStreamBindAuthorizer({
      resolveStream,
      resolveStreams,
      listStreams,
      auth,
      manageRuleId: qualifyAccessRuleId(pluginMetadata, tracestreamAccess.manage),
      objectType: tracestreamResourceTypes.stream,
      noun: "trace stream",
    });

  return {
    signal: "traces",
    // The qualified ReBAC resource type of this signal's streams, so the
    // platform can back-fill / clean up per-stream grants on binding changes.
    streamResourceType: tracestreamResourceTypes.stream,

    assertBindable,
    describeStream,
    ...(describeStreams ? { describeStreams } : {}),
    ...(listBindableStreams ? { listBindableStreams } : {}),

    async write({ streamId, records, now = new Date() }): Promise<TelemetrySinkWriteResult> {
      // Stream lookup and config resolution are independent - run concurrently.
      const [stream, config] = await Promise.all([
        resolveStream(streamId),
        configResolver.resolve(streamId),
      ]);
      if (!stream) {
        logger.warn(
          `tracestream: telemetry write to unknown stream "${streamId}"; rejecting ${records.length} record(s)`,
        );
        return { accepted: 0, rejected: records.length };
      }

      // A NormalizedSpan is exactly what the endpoints decode to, so the same
      // pipeline gives byte-for-byte parity (see the parity test). No mapping.
      const spans: NormalizedSpan[] = records;
      const result = pipeline.ingest({ streamId, spans, config, now });
      const rejected = result.rejectedRateLimit + result.rejectedBuffer;
      return { accepted: result.accepted, rejected };
    },
  };
}
