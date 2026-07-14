/**
 * Agent-side telemetry-pull scheduler. Consumes the "telemetry-pull"
 * `capability_config` the core pushes (the source instances BOUND to this
 * satellite) and, on each tick, runs the statically-compiled pure executor for
 * the instance's source type. Produced records (already JSON-safe wire records)
 * are forwarded as a "telemetry-pull" batch; per-instance health is emitted as
 * a `capability_status`. The reconcile / timer / concurrency-cap / in-flight
 * machinery and the JIT secret-cache lifecycle live in the shared
 * {@link CapabilityIntervalScheduler}; this module supplies only the
 * telemetry-pull seams.
 *
 * NO EXECUTOR => COUNTED FAILURE: an instance whose source type has no executor
 * compiled into this satellite build reports a per-instance failure ("source
 * type not available on this satellite build") and never crashes the scheduler.
 *
 * SECRETS: config secret fields NEVER ride the pushed config; the executor
 * fetches each JIT via `ctx.fetchSecret(field)`, which requests it from core over
 * the authenticated socket (`capability_secret_request`). Resolved values are
 * cached in memory per (instance, field) and FLUSHED on every `applyConfig`
 * (see the base's secret-cache lifecycle) so a rotated secret is re-fetched.
 */

import type { TelemetryEnqueuer } from "../enqueuer";
import {
  countWireRecords,
  filterWireRecordsToSignals,
  TELEMETRY_PULL_CAPABILITY_KIND,
  TelemetryPullConfigSchema,
  TelemetryPullSecretResponseSchema,
  type TelemetryPullBatchEntry,
  type TelemetryPullInstanceConfig,
  type TelemetryPullSecretRequest,
  type TelemetryPullStatus,
  type WirePullRecords,
} from "@checkstack/telemetry-common";
import {
  CapabilityIntervalScheduler,
  type FetchSecretFn,
  type Logger,
  type RunOutcome,
  type StatusEmitter,
} from "../interval-scheduler";
import {
  TelemetryPullExecutorRegistry,
  telemetryPullExecutorRegistry,
} from "./executor-registry";

export { TELEMETRY_PULL_CAPABILITY_KIND } from "@checkstack/telemetry-common";
export type { FetchSecretFn, StatusEmitter } from "../interval-scheduler";

/** One per-instance status update (an element of the shared status payload). */
type TelemetryPullStatusItem = TelemetryPullStatus[number];

/** Default cap on concurrent in-flight pull runs across all instances. */
export const DEFAULT_PULL_CONCURRENCY = 4;

/** True when two instance configs are identical for scheduling purposes. */
function sameConfig(
  a: TelemetryPullInstanceConfig,
  b: TelemetryPullInstanceConfig,
): boolean {
  // Both are parsed from the same wire schema, so a stable JSON encoding is a
  // sound equality check (a re-push of unchanged config stringifies identically).
  return JSON.stringify(a) === JSON.stringify(b);
}

export class TelemetryPullScheduler {
  /**
   * In-memory JIT secret cache, keyed by `${instanceId}::${field}`. Value is the
   * resolved secret (or `undefined` when the field holds none). NEVER persisted;
   * flushed by the base on every `applyConfig` and `stop()`.
   */
  private readonly secretCache = new Map<string, string | undefined>();
  private readonly enqueue: TelemetryEnqueuer;
  private readonly fetchSecret: FetchSecretFn;
  private readonly registry: TelemetryPullExecutorRegistry;
  private readonly base: CapabilityIntervalScheduler<
    TelemetryPullInstanceConfig,
    TelemetryPullStatusItem
  >;

  constructor(opts: {
    enqueue: TelemetryEnqueuer;
    emitStatus: StatusEmitter;
    fetchSecret: FetchSecretFn;
    logger: Logger;
    /** Executor lookup (defaults to the process-wide registry). */
    registry?: TelemetryPullExecutorRegistry;
    now?: () => Date;
    concurrency?: number;
  }) {
    this.enqueue = opts.enqueue;
    this.fetchSecret = opts.fetchSecret;
    this.registry = opts.registry ?? telemetryPullExecutorRegistry;
    this.base = new CapabilityIntervalScheduler({
      kind: TELEMETRY_PULL_CAPABILITY_KIND,
      label: "telemetry-pull",
      itemNoun: "source",
      logger: opts.logger,
      now: opts.now ?? (() => new Date()),
      concurrency: opts.concurrency ?? DEFAULT_PULL_CONCURRENCY,
      emitStatus: opts.emitStatus,
      parseConfig: (payload) => {
        const parsed = TelemetryPullConfigSchema.safeParse(payload);
        return parsed.success
          ? { items: parsed.data.instances }
          : { error: parsed.error.message };
      },
      sameConfig,
      flushSecrets: () => this.secretCache.clear(),
      runItem: ({ config }) => this.runPull(config),
      buildStatus: ({ config, lastError, consecutiveFailures, at }) => ({
        instanceId: config.id,
        lastRunAt: at,
        lastError,
        consecutiveFailures,
      }),
    });
  }

  /**
   * Apply a pushed "telemetry-pull" capability_config (reconciles per-instance
   * timers; see {@link CapabilityIntervalScheduler.applyConfig}).
   */
  applyConfig(payload: unknown): void {
    this.base.applyConfig(payload);
  }

  /** Ids of instances currently scheduled. */
  activeInstanceIds(): string[] {
    return this.base.activeIds();
  }

  /** Stop every timer and drop all in-memory secrets. */
  stop(): void {
    this.base.stop();
  }

  /**
   * Run one pull for an instance (by id), forward its records, and emit status.
   * Exposed for deterministic testing (drive it instead of the timer): it reuses
   * the same in-memory secret cache the timer path does.
   */
  async pullInstance(id: string): Promise<void> {
    return this.base.runOnce(id);
  }

  /**
   * The telemetry-pull work for one instance: look up its executor, run it under
   * a timeout, and forward the bound-signal records. A missing executor, a
   * thrown transport failure, or a timeout is returned as a failure outcome.
   */
  private async runPull(
    config: TelemetryPullInstanceConfig,
  ): Promise<RunOutcome> {
    const executor = this.registry.get(config.sourceTypeId);
    if (!executor) {
      return {
        ok: false,
        error: "source type not available on this satellite build",
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const produced = await executor.execute({
        config: config.config,
        fetchSecret: (field) => this.fetchSecretForField(config.id, field),
        abortSignal: controller.signal,
      });

      // Drop records for signals this instance does not route (the core would
      // reject an unbound signal anyway; dropping here saves the round-trip).
      const records = filterWireRecordsToSignals({
        records: produced,
        signals: config.boundSignals,
      });
      if (countWireRecords(records) > 0) {
        this.enqueue.enqueue({
          kind: TELEMETRY_PULL_CAPABILITY_KIND,
          items: [
            { instanceId: config.id, records } satisfies TelemetryPullBatchEntry,
          ],
          estimateBytes: estimatePullItemBytes,
          // A buffer drop is charged to this instance so the core surfaces it.
          groupKeyOf: () => config.id,
        });
      }
      return { ok: true };
    } catch (error) {
      const message = controller.signal.aborted
        ? `pull run timed out after ${config.timeoutMs}ms`
        : String(error);
      return { ok: false, error: message };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Resolve ONE config secret field JIT for an instance (cached in memory). The
   * executor calls this for a field it treats as secret; a resolution failure
   * THROWS so the run fails clearly (we never run with an unresolved secret).
   */
  private async fetchSecretForField(
    instanceId: string,
    field: string,
  ): Promise<string | undefined> {
    const key = `${instanceId}::${field}`;
    if (this.secretCache.has(key)) return this.secretCache.get(key);

    const resp = await this.fetchSecret({
      kind: TELEMETRY_PULL_CAPABILITY_KIND,
      payload: { instanceId, field } satisfies TelemetryPullSecretRequest,
    });
    if (resp.error !== undefined) {
      throw new Error(`secret unavailable: ${resp.error}`);
    }
    const parsed = TelemetryPullSecretResponseSchema.safeParse(resp.payload);
    if (!parsed.success) {
      throw new Error("secret unavailable: malformed secret response");
    }
    const value = parsed.data.value;
    this.secretCache.set(key, value);
    return value;
  }
}

/** Approximate the serialized bytes of one "telemetry-pull" batch item. */
export function estimatePullItemBytes(item: unknown): number {
  const typed = item as { instanceId: string; records: WirePullRecords };
  const count = countWireRecords(typed.records);
  // ~256 bytes/record (body + attributes + resource) is a proportional budget;
  // avoids an O(payload) JSON.stringify on every telemetry push.
  return typed.instanceId.length + 16 + count * 256;
}
