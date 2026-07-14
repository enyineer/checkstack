/**
 * The "telemetry-pull" satellite capability handler: a satellite executes PULL
 * runs for the telemetry source instances BOUND to it and forwards the produced
 * records; core assigns those instances (via `buildCapabilityConfig`), resolves
 * their config secrets just-in-time (`resolveSecret`), ingests the forwarded
 * batches (`handleTelemetryBatch`), and mirrors per-instance pull health
 * (`handleCapabilityStatus`). Mirrors metricstream's metric-scrape handler.
 *
 * AUTHORIZATION MODEL: a pull produces no token. A batch/status/secret is
 * authorized purely by the instance BINDING - core accepts an entry only when
 * the instance exists, is enabled, AND `instance.satelliteId === satelliteId`. A
 * mismatch (a satellite reporting for an instance it is not bound to) is rejected
 * and counted, never fed to the sink or resolved. This is the same "binding is
 * the authorization" shape the health-result and metric-scrape paths use.
 *
 * The handler NEVER duplicates routing logic: forwarded records go through the
 * SAME per-instance bound sink the core pull runner + webhook paths use, so
 * signal routing, stream ownership and per-signal accept/reject apply identically.
 *
 * SECRETS: config secrets NEVER ride the `capability_config` push (it re-crosses
 * the wire on every reconnect). The config only advertises which fields are
 * secret (`secretFields`); the agent fetches each field JIT via
 * `capability_secret_request` -> {@link resolveSecret}, which is binding-authorized
 * and returns the resolved value over the channel only.
 */

import { eq, inArray } from "drizzle-orm";
import type { Logger, SafeDatabase } from "@checkstack/backend-api";
import {
  TELEMETRY_PULL_CAPABILITY_KIND,
  TELEMETRY_SIGNALS,
  TelemetryPullBatchSchema,
  TelemetryPullSecretRequestSchema,
  TelemetryPullStatusSchema,
  countWireRecords,
  wirePullRecordsToNormalized,
  type TelemetryPullConfig,
  type TelemetryPullInstanceConfig,
  type TelemetryPullSecretResponse,
  type TelemetryRecordMap,
  type TelemetrySignal,
} from "@checkstack/telemetry-common";
import type { SatelliteCapabilityHandler } from "@checkstack/satellite-backend";
import * as schema from "../schema";
import { telemetrySources } from "../schema";
import { loadSourceRow, listSatelliteBoundSourceRows } from "../service";
import type { BoundTelemetrySink } from "../extension-points";
import {
  isSecretMarkerFor,
  stripSecretsForRead,
  type SourceSecretStore,
} from "../secrets";
import { clampInterval } from "../reconciler";
import { DEFAULT_PULL_TIMEOUT_MS } from "../runner";
import { createBoundSink } from "../bound-sink";
import type {
  TelemetrySinkRegistry,
  TelemetrySourceRegistry,
} from "../extension-points";

type Db = SafeDatabase<typeof schema>;

/** Normalized records for one pull run, keyed by signal (empty per absent signal). */
type NormalizedBySignal = { [S in TelemetrySignal]?: TelemetryRecordMap[S][] };

/**
 * Emit one signal's normalized records through the bound sink. Generic in the
 * signal so `normalized[signal]` and `sink.emit(signal, ...)` share ONE `S` (the
 * indexed-assignment typing pattern telemetry-common's `copyWireSignal` uses),
 * letting a `for (const signal of TELEMETRY_SIGNALS)` loop drive every signal
 * without hand-written per-signal blocks. A no-op (0/0) when the signal is absent.
 */
async function emitSignal<S extends TelemetrySignal>({
  sink,
  normalized,
  signal,
}: {
  sink: BoundTelemetrySink;
  normalized: NormalizedBySignal;
  signal: S;
}): Promise<{ accepted: number; rejected: number }> {
  const records = normalized[signal];
  if (!records || records.length === 0) return { accepted: 0, rejected: 0 };
  const result = await sink.emit(signal, records);
  return { accepted: result.accepted, rejected: result.rejected };
}

export function createTelemetryPullCapabilityHandler({
  db,
  sourceRegistry,
  sinkRegistry,
  secretStore,
  logger,
  now = () => new Date(),
}: {
  db: Db;
  sourceRegistry: TelemetrySourceRegistry;
  sinkRegistry: TelemetrySinkRegistry;
  /** Config-secret channel; resolves ONE field JIT for `resolveSecret`. */
  secretStore: SourceSecretStore;
  logger: Logger;
  now?: () => Date;
}): SatelliteCapabilityHandler {
  /**
   * Build the instance set this satellite should pull: every ENABLED, satellite-
   * bound instance whose type is registered, pull-capable and satellite-capable.
   * Config carries the NON-SECRET values only (secret markers are OMITTED and
   * listed in `secretFields`); the agent fetches each secret JIT via
   * {@link resolveSecret}. Always returns the complete set so the agent converges
   * exactly - a de-bound / deleted / disabled instance disappears from the list.
   */
  async function buildCapabilityConfig({
    satelliteId,
  }: {
    satelliteId: string;
  }): Promise<TelemetryPullConfig | null> {
    const rows = await listSatelliteBoundSourceRows({ db, satelliteId });
    const instances: TelemetryPullInstanceConfig[] = [];
    // Dedupe "type not available" logs so many instances of one missing type do
    // not spam the log on every reconcile push.
    const warnedTypes = new Set<string>();

    for (const row of rows) {
      const type = sourceRegistry.get(row.sourceTypeId);
      if (!type?.pull || !type.supportsSatellite) {
        if (!warnedTypes.has(row.sourceTypeId)) {
          warnedTypes.add(row.sourceTypeId);
          logger.debug(
            `telemetry: skipping satellite-bound source of type "${row.sourceTypeId}" ` +
              `(unknown, non-pull, or not satellite-capable) for satellite ${satelliteId}`,
          );
        }
        continue;
      }

      const boundSignals = [...new Set(row.bindings.map((b) => b.signal))];
      // The wire schema requires at least one bound signal; an instance with no
      // bindings routes nothing, so there is nothing to execute on the edge.
      if (boundSignals.length === 0) continue;

      const { config, storedSecretFields } = stripSecretsForRead({
        storedConfig: row.config,
        sourceId: row.id,
      });
      instances.push({
        id: row.id,
        sourceTypeId: row.sourceTypeId,
        name: row.name,
        intervalSeconds: clampInterval({
          requested: row.intervalSeconds,
          defaultSeconds: type.pull.defaultIntervalSeconds,
          minSeconds: type.pull.minIntervalSeconds,
        }),
        timeoutMs: DEFAULT_PULL_TIMEOUT_MS,
        config,
        secretFields: storedSecretFields,
        boundSignals,
      });
    }

    if (instances.length === 0) return null;
    return { instances };
  }

  /**
   * Resolve ONE bound instance's config secret JIT (a `capability_secret_request`
   * the WS handler routes here). BINDING IS THE AUTHORIZATION: the field is
   * resolved ONLY when the instance exists, is enabled AND is bound to the
   * requesting satellite - a mismatch/unknown/disabled instance returns an error
   * WITHOUT touching the secret store. The requested field must currently hold a
   * secret marker on the row. Returns `{ value }` (absent when the field holds no
   * stored secret). The plaintext is never persisted or logged.
   */
  async function resolveSecret({
    satelliteId,
    payload,
  }: {
    satelliteId: string;
    payload: unknown;
  }): Promise<{ payload?: unknown; error?: string }> {
    const parsed = TelemetryPullSecretRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return { error: "invalid telemetry-pull secret request" };
    }
    const { instanceId, field } = parsed.data;

    const row = await loadSourceRow({ db, id: instanceId });
    if (!row || !row.enabled || row.satelliteId !== satelliteId) {
      logger.warn(
        `telemetry: rejecting secret request from satellite ${satelliteId} ` +
          `for source ${instanceId} it is not bound to`,
      );
      return { error: "source not bound to this satellite" };
    }

    // The field must actually be a stored secret on this row - a satellite names
    // a field, it does not get to pull an arbitrary internal-store key.
    if (!isSecretMarkerFor({ value: row.config[field], sourceId: instanceId, field })) {
      return { error: "field is not a stored secret" };
    }

    try {
      const value = await secretStore.resolveField({
        sourceId: instanceId,
        field,
      });
      const response: TelemetryPullSecretResponse =
        value === undefined ? {} : { value };
      return { payload: response };
    } catch (error) {
      logger.warn(
        `telemetry: failed to resolve secret for satellite pull source ${instanceId}: ${String(error)}`,
      );
      return { error: "failed to resolve secret" };
    }
  }

  /**
   * Ingest one forwarded pull batch. Each entry is authorized by its instance's
   * binding to the sending satellite; records for an unknown / mismatched /
   * disabled instance are rejected (counted), never fed to a sink. Matched
   * entries route through the SAME per-instance bound sink the core pull path
   * uses, so signal routing and per-signal accept/reject apply identically.
   */
  async function handleTelemetryBatch({
    satelliteId,
    payload,
    droppedByGroup,
  }: {
    satelliteId: string;
    payload: unknown;
    droppedByGroup?: Record<string, number>;
  }): Promise<{ accepted: number; rejected: number; retryable?: boolean }> {
    const parsed = TelemetryPullBatchSchema.safeParse(payload);
    if (!parsed.success) {
      // A malformed batch is terminal, not transient: dropping it (non-retryable)
      // avoids an infinite resend of an un-parseable frame.
      logger.warn(
        `telemetry: dropping malformed telemetry-pull batch from satellite ${satelliteId}: ${parsed.error.message}`,
      );
      return { accepted: 0, rejected: 0, retryable: false };
    }

    const entries = parsed.data;
    const dropEntries = Object.entries(droppedByGroup ?? {}).filter(
      ([, count]) => count > 0,
    );
    if (entries.length === 0 && dropEntries.length === 0) {
      return { accepted: 0, rejected: 0 };
    }

    // Resolve every referenced instance's binding in ONE query (avoid an N+1) -
    // union of the payload's instances AND any drop-only instances, since a drop
    // can be reported for an instance with no records in this batch.
    const instanceIds = [
      ...new Set([
        ...entries.map((e) => e.instanceId),
        ...dropEntries.map(([instanceId]) => instanceId),
      ]),
    ];
    const rows = await db
      .select({
        id: telemetrySources.id,
        sourceTypeId: telemetrySources.sourceTypeId,
        satelliteId: telemetrySources.satelliteId,
        enabled: telemetrySources.enabled,
        bindings: telemetrySources.bindings,
      })
      .from(telemetrySources)
      .where(inArray(telemetrySources.id, instanceIds));
    const byId = new Map(rows.map((r) => [r.id, r]));

    let accepted = 0;
    let rejected = 0;
    for (const entry of entries) {
      const row = byId.get(entry.instanceId);
      // BINDING IS THE AUTHORIZATION: reject an unknown, disabled, or mismatched
      // instance. Count its records as rejected (dropped).
      if (!row || !row.enabled || row.satelliteId !== satelliteId) {
        const count = countWireRecords(entry.records);
        rejected += count;
        logger.warn(
          `telemetry: satellite ${satelliteId} forwarded pull records for source ` +
            `${entry.instanceId} it is not bound to; rejecting ${count} record(s)`,
        );
        continue;
      }

      const { sink } = createBoundSink({
        bindings: row.bindings,
        sinkRegistry,
        sourceRef: { sourceId: row.id, sourceTypeId: row.sourceTypeId },
        now,
      });
      const normalized = wirePullRecordsToNormalized(entry.records);
      for (const signal of TELEMETRY_SIGNALS) {
        const r = await emitSignal({ sink, normalized, signal });
        accepted += r.accepted;
        rejected += r.rejected;
      }
    }

    // Telemetry has no per-source in-transit drop recorder (unlike metricstream's
    // per-stream activity table); attribute nothing, just log the binding-valid
    // drops so the loss is observable without inventing a new table.
    for (const [instanceId, dropped] of dropEntries) {
      const row = byId.get(instanceId);
      if (!row || !row.enabled || row.satelliteId !== satelliteId) {
        logger.debug(
          `telemetry: satellite ${satelliteId} reported ${dropped} in-transit ` +
            `drop(s) for source ${instanceId} it is not bound to; ignoring`,
        );
        continue;
      }
      logger.debug(
        `telemetry: satellite ${satelliteId} dropped ${dropped} record(s) in ` +
          `transit for source ${instanceId}`,
      );
    }

    return { accepted, rejected };
  }

  /**
   * Mirror per-instance pull health reported by the satellite. Each entry is
   * binding-validated; the row's `lastRunAt` / `lastError` / `consecutiveFailures`
   * are set from the values the agent owns (absolute failure count, like
   * metric-scrape).
   */
  async function handleCapabilityStatus({
    satelliteId,
    payload,
  }: {
    satelliteId: string;
    payload: unknown;
  }): Promise<void> {
    const parsed = TelemetryPullStatusSchema.safeParse(payload);
    if (!parsed.success) {
      logger.warn(
        `telemetry: dropping malformed telemetry-pull status from satellite ${satelliteId}: ${parsed.error.message}`,
      );
      return;
    }

    const entries = parsed.data;
    if (entries.length === 0) return;

    // Resolve every referenced instance's binding in ONE query (sibling
    // handleTelemetryBatch batches the same way), then apply per-row UPDATEs.
    const instanceIds = [...new Set(entries.map((e) => e.instanceId))];
    const rows = await db
      .select({
        id: telemetrySources.id,
        satelliteId: telemetrySources.satelliteId,
        enabled: telemetrySources.enabled,
      })
      .from(telemetrySources)
      .where(inArray(telemetrySources.id, instanceIds));
    const byId = new Map(rows.map((r) => [r.id, r]));

    for (const entry of entries) {
      const row = byId.get(entry.instanceId);

      // BINDING IS THE AUTHORIZATION: ignore status for an instance this
      // satellite is not bound to (a stale report after a rebind, or a forged
      // one) OR one that is DISABLED - the batch + secret paths both reject a
      // disabled instance, so its health fields must not be overwritten either.
      if (!row || !row.enabled || row.satelliteId !== satelliteId) {
        logger.warn(
          `telemetry: ignoring telemetry-pull status from satellite ${satelliteId} ` +
            `for source ${entry.instanceId} it is not bound to (or disabled)`,
        );
        continue;
      }

      await db
        .update(telemetrySources)
        .set({
          lastRunAt: entry.lastRunAt ? new Date(entry.lastRunAt) : null,
          lastError: entry.lastError ?? null,
          consecutiveFailures: entry.consecutiveFailures,
          updatedAt: now(),
        })
        .where(eq(telemetrySources.id, entry.instanceId));
    }
  }

  return {
    kind: TELEMETRY_PULL_CAPABILITY_KIND,
    buildCapabilityConfig,
    resolveSecret,
    handleTelemetryBatch,
    handleCapabilityStatus,
  };
}
