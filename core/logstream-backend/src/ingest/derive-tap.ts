/**
 * Logstream's connection to the telemetry platform's DERIVE dispatcher.
 *
 * After a stream's flush COMMITS, the ingest pipeline hands the flushed lines to
 * this holder, which dispatches the batch to the platform as a LAZY thunk that
 * maps each {@link IngestedLine} back to a normalized {@link NormalizedLogRecord}
 * only when materialized. The platform routes it to any enabled derive source
 * configured on that log stream (log-to-metric, log-to-trace) - see
 * `telemetryDeriveTapExtensionPoint` - and materializes the thunk ONLY when at
 * least one enabled derive instance matches the stream, so streams without a
 * derive source pay zero conversion cost.
 *
 * Best-effort by contract: the holder is a no-op until the platform connects its
 * dispatch (a deployment without the telemetry plugin simply never derives), and
 * the pipeline fires it post-commit DETACHED (never awaited) inside its own error
 * isolation, so a slow or failing deriver can never break or slow ingest.
 *
 * {@link toNormalizedLogRecord} is the exact INVERSE of the telemetry sink's
 * `toIngestedLine` (`../telemetry-sink.ts`): a record ingested through the sink
 * and later derived recovers the same normalized shape. The parity is guarded by
 * `derive-tap.test.ts`.
 */

import type { IngestedLine } from "@checkstack/logstream-common";
import type {
  NormalizedLogRecord,
  TelemetryResource,
} from "@checkstack/telemetry-common";
import type { TelemetryDeriveDispatch } from "@checkstack/telemetry-backend";

/** Canonical resource key the sink folds `serviceName` into (see foldResource). */
const SERVICE_NAME_KEY = "service.name";

/**
 * Rebuild a {@link TelemetryResource} from the stored flat resource map: pull
 * `service.name` out as `serviceName`, keep every other key under `attributes`.
 * The inverse of the sink's `foldResource`. Returns undefined for an empty/absent
 * map so the record's `resource` stays undefined (never `{}`).
 */
function unfoldResource(
  resource: Record<string, unknown> | undefined,
): TelemetryResource | undefined {
  if (!resource) return undefined;
  const { [SERVICE_NAME_KEY]: serviceNameRaw, ...rest } = resource;
  const serviceName = typeof serviceNameRaw === "string" ? serviceNameRaw : undefined;
  const hasAttributes = Object.keys(rest).length > 0;
  if (serviceName === undefined && !hasAttributes) return undefined;
  return {
    ...(serviceName === undefined ? {} : { serviceName }),
    ...(hasAttributes ? { attributes: rest } : {}),
  };
}

/**
 * Map one flushed {@link IngestedLine} back to a {@link NormalizedLogRecord} for
 * the derive dispatcher. The exact inverse of `toIngestedLine`: it drops only the
 * sink-derived fields the deriver does not need (`observedAt`, `band`).
 */
export function toNormalizedLogRecord(line: IngestedLine): NormalizedLogRecord {
  const record: NormalizedLogRecord = {
    ts: line.ts,
    severityNumber: line.severityNumber,
    body: line.body,
  };
  if (line.severityText !== undefined) record.severityText = line.severityText;
  if (line.attributes !== undefined) record.attributes = line.attributes;
  const resource = unfoldResource(line.resource);
  if (resource !== undefined) record.resource = resource;
  if (line.traceId !== undefined) record.traceId = line.traceId;
  if (line.spanId !== undefined) record.spanId = line.spanId;
  return record;
}

/**
 * Pipeline-facing derive tap: post-commit, the pipeline calls
 * {@link onDeriveFlush} with a stream's flushed lines. No-op until a dispatch is
 * {@link connect}ed.
 */
export interface LogDeriveTap {
  /**
   * Called by the ingest pipeline AFTER a stream's flush commits, with the lines
   * flushed for that stream. Hands them to the platform's derive dispatcher as a
   * LAZY thunk (the mapping runs only if the dispatcher materializes it); returns
   * without work when no dispatch is connected or the batch is empty.
   */
  onDeriveFlush(input: { streamId: string; lines: IngestedLine[] }): Promise<void>;
  /** Connect the platform's derive dispatch (from the derive-tap extension point). */
  connect(dispatch: TelemetryDeriveDispatch): void;
}

/**
 * Build the mutable derive-tap holder. The pipeline receives its `onDeriveFlush`;
 * the telemetry wiring calls `connect(dispatch)` once the platform's derive
 * dispatcher hands one over (buffered behind the extension point, so load order
 * does not matter).
 */
export function createLogDeriveTap(): LogDeriveTap {
  let dispatch: TelemetryDeriveDispatch | null = null;
  return {
    connect(next) {
      dispatch = next;
    },
    async onDeriveFlush({ streamId, lines }) {
      // Skip all work when derivation is not wired or the batch is empty.
      if (!dispatch || lines.length === 0) return;
      // Hand the conversion as a LAZY thunk: the dispatcher materializes the
      // normalized records ONLY when at least one enabled derive instance
      // matches this stream, so a stream with no derive source pays zero
      // conversion cost.
      await dispatch({
        streamId,
        records: () => lines.map((line) => toNormalizedLogRecord(line)),
      });
    },
  };
}
