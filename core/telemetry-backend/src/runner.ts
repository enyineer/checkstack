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
  name: string;
  enabled: boolean;
  satelliteId: string | null;
  config: Record<string, unknown>;
  bindings: SourceBinding[];
}

/**
 * Seam over the shared row: load a run's row and stamp its success/failure
 * bookkeeping. DB-backed in production; faked in unit tests.
 *
 * `markFailure` atomically increments and RETURNS the new consecutive-failure
 * count; `markSuccess` reports whether this success RECOVERED the source from a
 * non-zero failure count (a returning-based conditional reset, so recovery is
 * detected exactly once even across pods). The runner uses both to drive the
 * type's optional `pull.onRunFailure` / `pull.onRunRecovery` health hooks.
 */
export interface PullRunStore {
  load(sourceId: string): Promise<PullRunRow | null>;
  markSuccess(input: {
    sourceId: string;
    at: Date;
  }): Promise<{ recovered: boolean }>;
  markFailure(input: {
    sourceId: string;
    at: Date;
    error: string;
  }): Promise<{ consecutiveFailures: number }>;
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
      const pull = type.pull;
      // A non-null binding of the narrowed row, so the nested closure below keeps
      // it non-null (control-flow narrowing does not cross a function boundary).
      const runRow = row;

      /**
       * Record a run failure, then best-effort-invoke the type's `onRunFailure`
       * health hook with the just-stored consecutive-failure count. A throw in
       * the hook is logged and never affects run bookkeeping. `config` is the
       * STORED config (secret markers unresolved) per the hook contract.
       */
      async function recordFailure(rawMessage: string): Promise<void> {
        const message = truncateError(rawMessage);
        const { consecutiveFailures } = await store.markFailure({
          sourceId,
          at: now(),
          error: message,
        });
        if (!pull.onRunFailure) return;
        try {
          await pull.onRunFailure({
            sourceId: runRow.id,
            sourceName: runRow.name,
            config: runRow.config,
            error: message,
            consecutiveFailures,
            bindings: runRow.bindings,
          });
        } catch (error) {
          logger.warn(
            `telemetry: pull onRunFailure hook failed for ${sourceId}: ${String(error)}`,
          );
        }
      }

      let config: unknown;
      try {
        const resolved = await secretStore.resolve({
          config: row.config,
          sourceId: row.id,
        });
        config = type.configSchema.parse(resolved);
      } catch (error) {
        await recordFailure(`config resolution failed: ${String(error)}`);
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
        await pull.execute({
          config,
          sink,
          fetch: fetchImpl,
          logger,
          abortSignal: controller.signal,
        });
        const { recovered } = await store.markSuccess({ sourceId, at: now() });
        // A success that cleared a non-zero failure count is the FIRST success
        // after failures - fire the recovery hook (best-effort) exactly once.
        if (recovered && pull.onRunRecovery) {
          try {
            await pull.onRunRecovery({
              sourceId: row.id,
              sourceName: row.name,
              config: row.config,
              bindings: row.bindings,
            });
          } catch (error) {
            logger.warn(
              `telemetry: pull onRunRecovery hook failed for ${sourceId}: ${String(error)}`,
            );
          }
        }
      } catch (error) {
        const message = controller.signal.aborted
          ? `pull run timed out after ${timeoutMs}ms`
          : String(error);
        await recordFailure(message);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
