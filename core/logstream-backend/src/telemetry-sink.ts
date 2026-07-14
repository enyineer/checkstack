/**
 * The logstream contribution to the telemetry platform's SINK extension point.
 * A telemetry SOURCE (a pull poller, a vendor webhook) hands the platform
 * normalized {@link NormalizedLogRecord}s; the platform routes them to the
 * stream's owning plugin through this sink, exactly as a source-token push feeds
 * the OTLP/native HTTP endpoints.
 *
 * The sink NEVER re-implements ingest policy. It reuses the SAME shared
 * normalization helpers the OTLP endpoint uses (severity resolution, the stream's
 * `severityRules.valueMap` band override, body truncation, attribute capping,
 * timestamp clamping) and hands the resulting {@link IngestedLine}s to the SAME
 * {@link IngestPipeline} - so banding, rate limits, buffering and sampling all
 * apply identically no matter how the log entered the platform.
 */

import { qualifyAccessRuleId } from "@checkstack/common";
import type { AuthService, Logger } from "@checkstack/backend-api";
import {
  applySeverityValueMap,
  capAttributes,
  clampEventTimestamp,
  logstreamAccess,
  logstreamResourceTypes,
  pluginMetadata,
  resolveSeverity,
  truncateBody,
  type IngestedLine,
  type LogStreamConfig,
} from "@checkstack/logstream-common";
import type {
  NormalizedLogRecord,
  TelemetryResource,
} from "@checkstack/telemetry-common";
import {
  createStreamBindAuthorizer,
  type TelemetrySinkContribution,
  type TelemetrySinkWriteResult,
} from "@checkstack/telemetry-backend";
import type { IngestPipeline } from "./ingest/pipeline";
import type { StreamConfigResolver } from "./ingest/stream-config";

/** Resolve a stream's identity by id, or null when it does not exist. */
export type ResolveLogStream = (
  streamId: string,
) => Promise<{ id: string; name: string } | null>;

/** Resolve many log streams by id in one query (unknown ids map to null). */
export type ResolveLogStreams = (
  streamIds: string[],
) => Promise<Record<string, { id: string; name: string } | null>>;

/** List every log stream (id + name) for the binding picker. */
export type ListLogStreams = () => Promise<{ id: string; name: string }[]>;

/**
 * Flatten a normalized record's resource into the stored `resource` attribute
 * object, mirroring the OTLP endpoint (which caps the whole resource kv object).
 * `serviceName` is written under the canonical `service.name` key and wins over
 * any `service.name` already present in the resource attributes. Returns
 * undefined for an empty resource so the stored column stays null.
 */
function foldResource(
  resource: TelemetryResource | undefined,
): Record<string, unknown> | undefined {
  if (!resource) return undefined;
  const flat: Record<string, unknown> = { ...resource.attributes };
  if (resource.serviceName !== undefined) flat["service.name"] = resource.serviceName;
  if (Object.keys(flat).length === 0) return undefined;
  return capAttributes({ attributes: flat });
}

/**
 * Map one normalized log record onto an {@link IngestedLine} using the exact
 * normalization the OTLP endpoint applies. Returns null for a record carrying no
 * usable content (empty body AND no attributes) - the same rule that feeds OTLP
 * `partialSuccess.rejectedLogRecords`.
 */
function toIngestedLine({
  record,
  config,
  now,
}: {
  record: NormalizedLogRecord;
  config: LogStreamConfig;
  now: Date;
}): IngestedLine | null {
  const observedAt = now;

  const severity = resolveSeverity({
    severityNumber: record.severityNumber,
    level: record.severityText,
  });
  // A per-stream valueMap override wins over the default band mapping, keyed on
  // the RAW source severity value - identical to the OTLP endpoint.
  const band = applySeverityValueMap({
    band: severity.band,
    rawValue: record.severityText,
    valueMap: config.severityRules?.valueMap,
  });

  const body = truncateBody({ body: record.body, maxBytes: config.maxLineBytes });
  const attributes = capAttributes({ attributes: record.attributes });
  if (body.length === 0 && !attributes) return null;

  const { ts } = clampEventTimestamp({ ts: record.ts, observedAt });

  return {
    ts,
    observedAt,
    severityNumber: severity.severityNumber,
    severityText: severity.severityText,
    band,
    body,
    attributes,
    resource: foldResource(record.resource),
    traceId: record.traceId || undefined,
    spanId: record.spanId || undefined,
  };
}

/**
 * Build the logstream telemetry sink contribution. `resolveStream` looks the
 * stream up by id (existence + display name); `pipeline` + `configResolver` are
 * the shared ingest seams; `auth` evaluates team grants for
 * {@link TelemetrySinkContribution.assertBindable}.
 */
export function createLogstreamTelemetrySink({
  resolveStream,
  resolveStreams,
  listStreams,
  pipeline,
  configResolver,
  auth,
  logger,
}: {
  resolveStream: ResolveLogStream;
  /** Batched resolver for list read paths; omit to fall back to per-id lookups. */
  resolveStreams?: ResolveLogStreams;
  /** List all streams for the binding picker; omit to disable the picker. */
  listStreams?: ListLogStreams;
  pipeline: IngestPipeline;
  configResolver: StreamConfigResolver;
  auth: Pick<AuthService, "check" | "listAccessibleObjectIds">;
  logger: Logger;
}): TelemetrySinkContribution<"logs"> {
  const { assertBindable, describeStream, describeStreams, listBindableStreams } =
    createStreamBindAuthorizer({
      resolveStream,
      resolveStreams,
      listStreams,
      auth,
      manageRuleId: qualifyAccessRuleId(pluginMetadata, logstreamAccess.manage),
      objectType: logstreamResourceTypes.stream,
      noun: "log stream",
    });

  return {
    signal: "logs",

    assertBindable,
    describeStream,
    ...(describeStreams ? { describeStreams } : {}),
    ...(listBindableStreams ? { listBindableStreams } : {}),

    async write({ streamId, records, now = new Date() }): Promise<TelemetrySinkWriteResult> {
      // Stream lookup and config resolution are independent - run concurrently.
      // The config result is simply discarded when the stream is unknown.
      const [stream, config] = await Promise.all([
        resolveStream(streamId),
        configResolver.resolve(streamId),
      ]);
      if (!stream) {
        logger.warn(
          `logstream: telemetry write to unknown stream "${streamId}"; rejecting ${records.length} record(s)`,
        );
        return { accepted: 0, rejected: records.length };
      }

      const lines: IngestedLine[] = [];
      let rejectedNormalize = 0;
      for (const record of records) {
        const line = toIngestedLine({ record, config, now });
        if (!line) {
          rejectedNormalize += 1;
          continue;
        }
        lines.push(line);
      }

      if (lines.length === 0) {
        return { accepted: 0, rejected: rejectedNormalize };
      }

      const result = pipeline.ingest({ streamId, lines, config, now });
      const rejected =
        rejectedNormalize + result.rejectedRateLimit + result.rejectedBuffer;
      return { accepted: result.accepted, rejected };
    },
  };
}
