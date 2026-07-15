/**
 * The metricstream contribution to the telemetry platform's SINK extension
 * point. A telemetry SOURCE (a pull poller, a vendor webhook) hands the platform
 * normalized {@link NormalizedMetricPoint}s; the platform routes them to the
 * stream's owning plugin through this sink, exactly as a source-token push feeds
 * the OTLP/native HTTP endpoints.
 *
 * The sink NEVER re-implements ingest policy: it maps each normalized point onto
 * metricstream's own {@link NormalizedDatapoint} (the two share type/counter-kind
 * literals ON PURPOSE - see telemetry-common's records.ts) and hands the batch to
 * the SAME {@link MetricIngestSink} the push endpoints and the scrape scheduler
 * use, so clamping, buffering, cardinality caps and folding all apply uniformly.
 *
 * Resource identity is folded into the series labels using the IDENTICAL
 * allowlist + precedence the OTLP normalizer applies
 * ({@link OTLP_RESOURCE_LABEL_ALLOWLIST}, point labels win over resource labels),
 * so a metric that arrives via a telemetry source keys onto the same series it
 * would via a direct OTLP push.
 */

import { qualifyAccessRuleId } from "@checkstack/common";
import type { AuthService, Logger } from "@checkstack/backend-api";
import {
  OTLP_RESOURCE_LABEL_ALLOWLIST,
  metricstreamAccess,
  metricstreamResourceTypes,
  pluginMetadata,
  type NormalizedDatapoint,
} from "@checkstack/metricstream-common";
import type { TelemetryResource } from "@checkstack/telemetry-common";
import {
  createStreamBindAuthorizer,
  type TelemetrySinkContribution,
  type TelemetrySinkWriteResult,
} from "@checkstack/telemetry-backend";
import type { MetricIngestSink } from "./sources/ingest-sink";

/** Resolve a stream's identity by id, or null when it does not exist. */
export type ResolveMetricStream = (
  streamId: string,
) => Promise<{ id: string; name: string } | null>;

/** Resolve many metric streams by id in one query (unknown ids map to null). */
export type ResolveMetricStreams = (
  streamIds: string[],
) => Promise<Record<string, { id: string; name: string } | null>>;

/** List every metric stream (id + name) for the binding picker. */
export type ListMetricStreams = () => Promise<{ id: string; name: string }[]>;

/** Coerce a resource attribute value to a label string (mirrors the OTLP fold). */
function toLabelString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Fold a normalized record's resource into series labels, using the SAME
 * allowlist + precedence metricstream's OTLP normalizer applies: only the
 * allowlisted resource attribute keys are admitted, and `serviceName` maps to the
 * `service.name` label and wins over any `service.name` present in the resource
 * attributes. Point labels are layered on top by the caller (point wins on clash).
 */
function foldResourceLabels(
  resource: TelemetryResource | undefined,
): Record<string, string> {
  const labels: Record<string, string> = {};
  if (!resource) return labels;
  const attributes = resource.attributes ?? {};
  for (const key of OTLP_RESOURCE_LABEL_ALLOWLIST) {
    const value = attributes[key];
    if (value !== undefined && value !== null) labels[key] = toLabelString(value);
  }
  if (resource.serviceName !== undefined) {
    labels["service.name"] = resource.serviceName;
  }
  return labels;
}

/**
 * Build the metricstream telemetry sink contribution. `resolveStream` looks the
 * stream up by id (existence + display name); `sink` is the shared ingest sink;
 * `auth` evaluates team grants for {@link TelemetrySinkContribution.assertBindable}.
 */
export function createMetricstreamTelemetrySink({
  resolveStream,
  resolveStreams,
  listStreams,
  sink,
  auth,
  logger,
}: {
  resolveStream: ResolveMetricStream;
  /** Batched resolver for list read paths; omit to fall back to per-id lookups. */
  resolveStreams?: ResolveMetricStreams;
  /** List all streams for the binding picker; omit to disable the picker. */
  listStreams?: ListMetricStreams;
  sink: MetricIngestSink;
  auth: Pick<AuthService, "check" | "listAccessibleObjectIds">;
  logger: Logger;
}): TelemetrySinkContribution<"metrics"> {
  const { assertBindable, describeStream, describeStreams, listBindableStreams } =
    createStreamBindAuthorizer({
      resolveStream,
      resolveStreams,
      listStreams,
      auth,
      manageRuleId: qualifyAccessRuleId(
        pluginMetadata,
        metricstreamAccess.manage,
      ),
      objectType: metricstreamResourceTypes.stream,
      noun: "metric stream",
    });

  return {
    signal: "metrics",
    // The qualified ReBAC resource type of this signal's streams, so the
    // platform can back-fill / clean up per-stream grants on binding changes.
    streamResourceType: metricstreamResourceTypes.stream,

    assertBindable,
    describeStream,
    ...(describeStreams ? { describeStreams } : {}),
    ...(listBindableStreams ? { listBindableStreams } : {}),

    async write({ streamId, records, now = new Date() }): Promise<TelemetrySinkWriteResult> {
      const stream = await resolveStream(streamId);
      if (!stream) {
        logger.warn(
          `metricstream: telemetry write to unknown stream "${streamId}"; rejecting ${records.length} record(s)`,
        );
        return { accepted: 0, rejected: records.length };
      }

      const datapoints: NormalizedDatapoint[] = records.map((record) => ({
        name: record.name,
        // The literals are shared with telemetry-common ON PURPOSE, so these
        // map 1:1 with no translation table (guarded by this module's tests).
        type: record.type,
        counterKind: record.counterKind,
        unit: record.unit,
        // Point labels win over folded resource labels on a key clash, exactly
        // like the OTLP normalizer's `buildLabels`.
        labels: { ...foldResourceLabels(record.resource), ...record.labels },
        value: record.value,
        // The shared sink clamps ts into the trust window; pass it through.
        ts: record.ts,
        // Carry trace-context exemplars so the ExemplarLane appears for metrics
        // arriving via the telemetry platform (scraped targets included). The
        // NormalizedDatapoint field is optional - only set it when present.
        ...(record.exemplars ? { exemplars: record.exemplars } : {}),
      }));

      const result = sink.ingest({ streamId, datapoints, now });
      return { accepted: result.accepted, rejected: result.rejected };
    },
  };
}
