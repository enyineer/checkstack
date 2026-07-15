/**
 * Built-in DERIVE source type: synthesize spans from correlated log records.
 * Platform-generic (consumes only {@link NormalizedLogRecord}), so it lives in
 * the telemetry platform and registers through the source extension point.
 *
 * ONLY records that carry BOTH a valid W3C `traceId` (32 hex) AND `spanId` (16
 * hex) become spans - a log without trace context cannot be placed in a trace,
 * so it is skipped (counted, logged at debug). We never SYNTHESIZE a span id: a
 * fabricated id would collide across unrelated logs and corrupt the trace tree.
 * Logs already carry these ids when the source emitted them or logstream's
 * trace-extraction filled them, so the correlation is the user's, not ours.
 *
 * Each span is `kind: "internal"`, ends at the record's ts, and starts
 * `durationAttribute` milliseconds earlier when that numeric attribute is present
 * (else it is a zero-width span at the log ts). Error-level severity maps to an
 * error span status.
 */

import { z } from "zod";
import {
  LOG_TO_TRACE_LOCAL_ID,
  type NormalizedLogRecord,
  type NormalizedSpan,
  type TelemetrySignal,
} from "@checkstack/telemetry-common";
import { defineTelemetrySourceType } from "../extension-points";
import { getLabelByPath, getNumberByPath } from "./attribute-path";

/** OTel severity number at/above which a span is marked `error` (ERROR=17). */
const ERROR_SEVERITY_NUMBER = 17;
const TRACE_ID_RE = /^[0-9a-f]{32}$/;
const SPAN_ID_RE = /^[0-9a-f]{16}$/;

/** Sentinel meaning "use the record's resource.serviceName" for serviceNameFrom. */
export const SERVICE_NAME_FROM_RESOURCE = "resource";

export const LogToTraceConfigSchema = z.object({
  /** The INPUT log stream this instance derives from (a log stream id). */
  inputStreamId: z.string().min(1),
  /** Dot-path to a numeric duration in MILLISECONDS; span start = ts - duration. */
  durationAttribute: z.string().min(1).optional(),
  /** Dot-path whose string value names the span (wins over fixedName). */
  nameAttribute: z.string().min(1).optional(),
  /** Constant span name used when nameAttribute is absent/unresolved. */
  fixedName: z.string().min(1).optional(),
  /**
   * Where the span's service name comes from: the literal "resource" (the
   * record's resource.serviceName, the default) or an attribute dot-path.
   */
  serviceNameFrom: z.string().min(1).optional(),
});

export type LogToTraceConfig = z.infer<typeof LogToTraceConfigSchema>;

/** Result of a fold: the built spans plus how many records lacked trace context. */
export interface LogToTraceFoldResult {
  spans: NormalizedSpan[];
  /** Records skipped because they carried no valid trace+span id pair. */
  skippedNoTrace: number;
}

function resolveName({
  record,
  config,
}: {
  record: NormalizedLogRecord;
  config: LogToTraceConfig;
}): string {
  if (config.nameAttribute) {
    const value = getLabelByPath({ attributes: record.attributes, path: config.nameAttribute });
    if (value !== undefined && value.length > 0) return value;
  }
  if (config.fixedName) return config.fixedName;
  return "log";
}

function resolveServiceName({
  record,
  config,
}: {
  record: NormalizedLogRecord;
  config: LogToTraceConfig;
}): string | undefined {
  const from = config.serviceNameFrom;
  if (from === undefined || from === SERVICE_NAME_FROM_RESOURCE) {
    return record.resource?.serviceName;
  }
  return getLabelByPath({ attributes: record.attributes, path: from });
}

/**
 * Fold one flushed batch of log records into spans. Pure and deterministic. A
 * record contributes a span only when it carries a valid trace id AND span id;
 * everything else increments `skippedNoTrace`.
 */
export function foldLogsToTrace({
  config,
  records,
}: {
  config: LogToTraceConfig;
  records: readonly NormalizedLogRecord[];
}): LogToTraceFoldResult {
  const spans: NormalizedSpan[] = [];
  let skippedNoTrace = 0;

  for (const record of records) {
    const traceId = record.traceId;
    const spanId = record.spanId;
    if (
      traceId === undefined ||
      spanId === undefined ||
      !TRACE_ID_RE.test(traceId) ||
      !SPAN_ID_RE.test(spanId)
    ) {
      skippedNoTrace += 1;
      continue;
    }

    const endTs = record.ts;
    const duration = config.durationAttribute
      ? getNumberByPath({ attributes: record.attributes, path: config.durationAttribute })
      : undefined;
    // A negative / non-finite duration is ignored (zero-width span) rather than
    // producing a start after the end.
    const startTs =
      duration !== undefined && duration > 0
        ? new Date(endTs.getTime() - duration)
        : endTs;

    const isError =
      record.severityNumber !== undefined &&
      record.severityNumber >= ERROR_SEVERITY_NUMBER;

    const serviceName = resolveServiceName({ record, config });

    spans.push({
      traceId,
      spanId,
      name: resolveName({ record, config }),
      kind: "internal",
      startTs,
      endTs,
      status: { code: isError ? "error" : "unset" },
      attributes: record.attributes,
      resource: serviceName === undefined ? undefined : { serviceName },
    });
  }

  return { spans, skippedNoTrace };
}

export function createLogToTraceSourceType() {
  return defineTelemetrySourceType<LogToTraceConfig>({
    id: LOG_TO_TRACE_LOCAL_ID,
    displayName: "Logs to trace",
    description:
      "Synthesize spans from log records that carry W3C trace and span ids, " +
      "correlating logs into your trace view.",
    icon: "Spline",
    signals: ["traces"] satisfies TelemetrySignal[],
    configSchema: LogToTraceConfigSchema,
    derive: {
      fromSignal: "logs",
      getInputStreamId: (config) => config.inputStreamId,
      async process({ config, records, sink, logger }) {
        // fromSignal is "logs": the signal-erased union only ever holds log
        // records here (see TelemetryDeriveContext).
        const logs = records as readonly NormalizedLogRecord[];
        const { spans, skippedNoTrace } = foldLogsToTrace({ config, records: logs });
        if (skippedNoTrace > 0) {
          logger.debug(
            `telemetry log-to-trace: skipped ${skippedNoTrace} record(s) with no trace context`,
          );
        }
        if (spans.length > 0) await sink.emit("traces", spans);
      },
    },
  });
}
