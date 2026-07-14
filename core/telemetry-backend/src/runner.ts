/**
 * Per-instance pull executor. On each fire the reconciler's consumer calls
 * {@link PullRunner.run}: load the (possibly-changed) row FRESH, resolve its
 * config secrets just-in-time, build the bound sink + SSRF-guarded fetch + a
 * per-run abort timeout, invoke the type's `pull.execute`, and record the
 * outcome in the shared row. All run state lives in Postgres, so any pod may run
 * any fire (state-and-scale).
 *
 * A THROW from `execute` (or a config-resolution failure) is a transport/config
 * failure: it increments `consecutiveFailures` and records `lastError`. A clean
 * return resets the failure counter and stamps `lastRunAt`.
 */

import type { Logger } from "@checkstack/backend-api";
import { createBoundSink } from "./bound-sink";
import { createGuardedFetch, type GuardedLookupFn } from "@checkstack/backend-api";
import type {
  TelemetrySinkRegistry,
  TelemetrySourceRegistry,
} from "./extension-points";
import type { SourceSecretStore } from "./secrets";
import type { SourceBinding } from "@checkstack/telemetry-common";

/** Default per-run wall-clock budget before the run is aborted. */
export const DEFAULT_PULL_TIMEOUT_MS = 30_000;
/** Max chars persisted from an error message. */
export const MAX_LAST_ERROR_CHARS = 2000;

/** The row shape a run needs. */
export interface PullRunRow {
  id: string;
  sourceTypeId: string;
  enabled: boolean;
  satelliteId: string | null;
  config: Record<string, unknown>;
  bindings: SourceBinding[];
}

/**
 * Seam over the shared row: load a run's row and stamp its success/failure
 * bookkeeping. DB-backed in production; faked in unit tests.
 */
export interface PullRunStore {
  load(sourceId: string): Promise<PullRunRow | null>;
  markSuccess(input: { sourceId: string; at: Date }): Promise<void>;
  markFailure(input: {
    sourceId: string;
    at: Date;
    error: string;
  }): Promise<void>;
}

export interface PullRunner {
  run(input: { sourceId: string }): Promise<void>;
}

/** Truncate an error message to the persisted cap. */
export function truncateError(message: string): string {
  return message.length > MAX_LAST_ERROR_CHARS
    ? `${message.slice(0, MAX_LAST_ERROR_CHARS)}…`
    : message;
}

export function createPullRunner({
  store,
  sourceRegistry,
  sinkRegistry,
  secretStore,
  logger,
  timeoutMs = DEFAULT_PULL_TIMEOUT_MS,
  now = () => new Date(),
  lookupFn,
}: {
  store: PullRunStore;
  sourceRegistry: TelemetrySourceRegistry;
  sinkRegistry: TelemetrySinkRegistry;
  secretStore: SourceSecretStore;
  logger: Logger;
  timeoutMs?: number;
  now?: () => Date;
  /** DNS resolver seam for the guarded fetch (tests inject a stub). */
  lookupFn?: GuardedLookupFn;
}): PullRunner {
  return {
    async run({ sourceId }) {
      const row = await store.load(sourceId);
      // Stale fire (reconcile will cancel it): gone, disabled, or satellite-bound.
      if (!row || !row.enabled || row.satelliteId) return;

      const type = sourceRegistry.get(row.sourceTypeId);
      if (!type?.pull) return;

      let config: unknown;
      try {
        const resolved = await secretStore.resolve({
          config: row.config,
          sourceId: row.id,
        });
        config = type.configSchema.parse(resolved);
      } catch (error) {
        await store.markFailure({
          sourceId,
          at: now(),
          error: truncateError(`config resolution failed: ${String(error)}`),
        });
        return;
      }

      const { sink } = createBoundSink({
        bindings: row.bindings,
        sinkRegistry,
        sourceRef: { sourceId: row.id, sourceTypeId: row.sourceTypeId },
        now,
      });
      const fetchImpl = createGuardedFetch({
        logger,
        ...(lookupFn === undefined ? {} : { lookupFn }),
      });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        await type.pull.execute({
          config,
          sink,
          fetch: fetchImpl,
          logger,
          abortSignal: controller.signal,
        });
        await store.markSuccess({ sourceId, at: now() });
      } catch (error) {
        const message = controller.signal.aborted
          ? `pull run timed out after ${timeoutMs}ms`
          : String(error);
        await store.markFailure({
          sourceId,
          at: now(),
          error: truncateError(message),
        });
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
