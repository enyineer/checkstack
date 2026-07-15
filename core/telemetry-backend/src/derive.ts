/**
 * The DERIVE dispatcher: signal-to-signal derivation over already-ingested
 * telemetry.
 *
 * A DERIVE source type (`log-to-metric`, `log-to-trace`, ...) declares a
 * `fromSignal` it CONSUMES and an input stream it reads (via
 * `derive.getInputStreamId(config)`). The plugin that OWNS that input signal
 * (logstream owns "logs") taps its own post-flush batches to the platform through
 * {@link telemetryDeriveTapExtensionPoint}; the platform routes each batch to the
 * enabled derive instances configured on that input stream and lets them emit
 * DIFFERENT signals through the same bound-sink machinery every other source
 * uses.
 *
 * Best-effort by contract (see {@link TelemetryDeriveDispatch}): the tap runs
 * AFTER the input stream's own flush committed, so a slow/failing deriver can
 * never delay or fail ingest; a per-source throw is recorded as that instance's
 * `lastError` and nothing else.
 *
 * STATE & SCALE (see `.claude/rules/state-and-scale.md` /
 * `.claude/rules/optimization.md`): the per-signal source list is a POD-LOCAL
 * CACHE derived from the shared `telemetry_sources` table, invalidated by the
 * broadcast {@link telemetrySourceReconcileHook} the source CRUD already emits -
 * the SAME convergence path the listener manager uses. It is not a source of
 * truth: every pod rebuilds identically from Postgres on first use after an
 * invalidation, so a read is the same on every pod. This avoids re-querying
 * Postgres on every flush batch (which would put a SELECT on the ingest tail)
 * while staying coherent cluster-wide - the correct cache per the optimization
 * rule (shared PG source, hook-invalidated, not a bespoke TTL map).
 */

import type {
  EventBus,
  HookUnsubscribe,
  Logger,
} from "@checkstack/backend-api";
import {
  pluginMetadata,
  type SourceBinding,
  type TelemetryRecord,
  type TelemetrySignal,
} from "@checkstack/telemetry-common";
import { createBoundSink } from "./bound-sink";
import { resolveRunnableConfig } from "./service";
import { truncateError } from "./runner";
import { telemetrySourceReconcileHook } from "./events";
import type { SourceSecretStore } from "./secrets";
import type {
  RegisteredTelemetrySourceType,
  TelemetryDeriveDispatch,
  TelemetryDeriveTapExtensionPoint,
  TelemetrySinkRegistry,
  TelemetrySourceRegistry,
} from "./extension-points";

/**
 * How the platform wires the dispatcher to the tap extension point across the
 * register()/init() split: `createDeriveTapPoint()` is created and registered as
 * {@link telemetryDeriveTapExtensionPoint} in register() (where
 * `registerExtensionPoint` lives), then `activate(dispatcher.dispatchForSignal)`
 * is called in init() once the dispatcher (which needs the db) exists. A
 * `connectTap` buffered before activation flushes at activation; later taps
 * resolve immediately.
 */

/**
 * Only clear/stamp a derive instance's success bookkeeping at most this often per
 * source per pod. Derive "runs" fire per flush batch (sub-second), so stamping
 * `lastRunAt` on every batch would amplify writes with no signal; a recovery from
 * a recorded failure always writes immediately regardless.
 */
export const DERIVE_SUCCESS_STAMP_THROTTLE_MS = 60_000;

/** The row shape a derive dispatch needs. */
export interface DeriveRow {
  id: string;
  sourceTypeId: string;
  enabled: boolean;
  config: Record<string, unknown>;
  bindings: SourceBinding[];
}

/**
 * Seam over the shared row: enumerate the ENABLED derive-mode instances, and
 * stamp success/failure bookkeeping. DB-backed in setup, faked in tests.
 * `markSuccess` clears `lastError`/`consecutiveFailures` and stamps `lastRunAt`
 * (reuse the pull run store's `markSuccess`); `markFailure` records the error and
 * bumps the counter (the shared `markFailure`).
 */
export interface DeriveStore {
  /** Every ENABLED instance; the dispatcher filters to those with a derive seam. */
  listEnabled(): Promise<DeriveRow[]>;
  markSuccess(input: { sourceId: string; at: Date }): Promise<void>;
  markFailure(input: {
    sourceId: string;
    at: Date;
    error: string;
  }): Promise<void>;
}

/** One resolved, matchable derive instance in the pod-local cache. */
interface DeriveEntry {
  row: DeriveRow;
  type: RegisteredTelemetrySourceType;
  inputStreamId: string;
}

export interface DeriveDispatcher {
  /**
   * Build the dispatch bound to one input signal. Pass this to the derive tap
   * point's `activate(...)` so a sink-owning plugin's `connectTap({ signal })`
   * receives its signal-bound {@link TelemetryDeriveDispatch}.
   */
  dispatchForSignal(signal: TelemetrySignal): TelemetryDeriveDispatch;
  /** Subscribe to the reconcile hook so a source CRUD invalidates the cache. */
  start(): Promise<void>;
  /** Unsubscribe (best-effort). */
  stop(): Promise<void>;
  /** Drop the cached source lists (tests; also the hook handler). */
  invalidate(): void;
}

/**
 * A buffered derive-tap extension point. A `connectTap` before {@link activate}
 * is buffered; once activated (the dispatcher exists) every buffered tap's
 * `onReady` fires with its signal-bound dispatch, and later taps resolve
 * immediately. Exported so the buffering is unit-testable without a dispatcher.
 */
export function createDeriveTapPoint(): {
  point: TelemetryDeriveTapExtensionPoint;
  activate(resolve: (signal: TelemetrySignal) => TelemetryDeriveDispatch): void;
} {
  const buffered: { signal: TelemetrySignal; onReady(d: TelemetryDeriveDispatch): void }[] = [];
  let resolveDispatch:
    | ((signal: TelemetrySignal) => TelemetryDeriveDispatch)
    | null = null;

  return {
    point: {
      connectTap({ signal, onReady }) {
        if (resolveDispatch) {
          onReady(resolveDispatch(signal));
          return;
        }
        buffered.push({ signal, onReady });
      },
    },
    activate(resolve) {
      resolveDispatch = resolve;
      // Flush in registration order; each buffered tap gets its signal-bound
      // dispatch exactly once.
      while (buffered.length > 0) {
        const tap = buffered.shift()!;
        tap.onReady(resolve(tap.signal));
      }
    },
  };
}

export function createDeriveDispatcher({
  store,
  sourceRegistry,
  sinkRegistry,
  secretStore,
  eventBus,
  logger,
  now = () => new Date(),
}: {
  store: DeriveStore;
  sourceRegistry: TelemetrySourceRegistry;
  sinkRegistry: TelemetrySinkRegistry;
  secretStore: SourceSecretStore;
  eventBus?: EventBus;
  logger: Logger;
  now?: () => Date;
}): DeriveDispatcher {
  /** Per-signal resolved derive instances; null when it must be rebuilt. */
  let cache: Map<TelemetrySignal, DeriveEntry[]> | null = null;
  /** In-flight build so concurrent flushes share one rebuild, never N queries. */
  let building: Promise<Map<TelemetrySignal, DeriveEntry[]>> | null = null;
  /**
   * Monotonic invalidation counter. Bumped on every {@link invalidate}; a build
   * captures it BEFORE reading the store and only adopts its snapshot into
   * `cache` if the counter is unchanged when it resolves. This closes the race
   * where an invalidation (a source CRUD) lands WHILE a build is in flight: the
   * in-flight build read the PRE-CRUD row set, so writing its snapshot would
   * wedge the pod on stale derive instances until the next unrelated CRUD.
   */
  let generation = 0;
  /** Sources this pod has recorded as failing (so recovery clears exactly once). */
  const failing = new Set<string>();
  /** Last time this pod stamped a success for a source (write throttle). */
  const lastSuccessStampMs = new Map<string, number>();
  let unsubscribe: HookUnsubscribe | null = null;

  /** Drop the cached lists and bump the generation so an in-flight build's
   * pre-invalidation snapshot is discarded rather than adopted. */
  function invalidate(): void {
    generation += 1;
    cache = null;
  }

  async function buildCache(): Promise<Map<TelemetrySignal, DeriveEntry[]>> {
    const rows = await store.listEnabled();
    const bySignal = new Map<TelemetrySignal, DeriveEntry[]>();
    for (const row of rows) {
      if (!row.enabled) continue;
      const type = sourceRegistry.get(row.sourceTypeId);
      if (!type?.derive) continue;
      let inputStreamId: string;
      try {
        // Parse (no secret resolution needed to READ the input stream id - it is
        // a plain field; secret markers still parse as strings). A broken config
        // is skipped, never fatal to the whole rebuild.
        const parsed = type.configSchema.parse(row.config);
        inputStreamId = type.derive.getInputStreamId(parsed);
      } catch (error) {
        logger.warn(
          `telemetry derive: skipping source ${row.id} with invalid config: ${String(error)}`,
        );
        continue;
      }
      const list = bySignal.get(type.derive.fromSignal) ?? [];
      list.push({ row, type, inputStreamId });
      bySignal.set(type.derive.fromSignal, list);
    }
    return bySignal;
  }

  async function getEntries(signal: TelemetrySignal): Promise<DeriveEntry[]> {
    if (cache) return cache.get(signal) ?? [];
    // Coalesce concurrent rebuilds: the first flush after an invalidation runs
    // ONE query; the rest await it.
    if (!building) {
      // Capture the generation BEFORE the store read. If an invalidation bumps
      // it while the read is in flight, this snapshot is stale (built from the
      // pre-CRUD rows) and MUST NOT be written to `cache` - a later getEntries
      // then rebuilds from the current rows. Awaiting callers still receive
      // `built` (the best snapshot available for their in-flight dispatch).
      const builtForGeneration = generation;
      building = buildCache()
        .then((built) => {
          if (generation === builtForGeneration) cache = built;
          return built;
        })
        .finally(() => {
          building = null;
        });
    }
    const built = await building;
    return built.get(signal) ?? [];
  }

  async function recordSuccess(sourceId: string): Promise<void> {
    const wasFailing = failing.delete(sourceId);
    const nowMs = now().getTime();
    const lastMs = lastSuccessStampMs.get(sourceId) ?? 0;
    // Always write on recovery from a recorded failure; otherwise throttle the
    // `lastRunAt` stamp so healthy per-batch derivation does not amplify writes.
    if (!wasFailing && nowMs - lastMs < DERIVE_SUCCESS_STAMP_THROTTLE_MS) return;
    lastSuccessStampMs.set(sourceId, nowMs);
    try {
      await store.markSuccess({ sourceId, at: now() });
    } catch (error) {
      logger.debug(
        `telemetry derive: markSuccess failed for ${sourceId}: ${String(error)}`,
      );
    }
  }

  async function recordFailure(sourceId: string, message: string): Promise<void> {
    failing.add(sourceId);
    try {
      await store.markFailure({
        sourceId,
        at: now(),
        error: truncateError(message),
      });
    } catch (error) {
      logger.debug(
        `telemetry derive: markFailure failed for ${sourceId}: ${String(error)}`,
      );
    }
  }

  async function processEntry(
    entry: DeriveEntry,
    input: {
      streamId: string;
      records: readonly TelemetryRecord<TelemetrySignal>[];
    },
  ): Promise<void> {
    try {
      const config = await resolveRunnableConfig({
        type: entry.type,
        config: entry.row.config,
        sourceId: entry.row.id,
        secretStore,
      });
      const { sink } = createBoundSink({
        bindings: entry.row.bindings,
        sinkRegistry,
        sourceRef: { sourceId: entry.row.id, sourceTypeId: entry.row.sourceTypeId },
        now,
      });
      await entry.type.derive!.process({
        config,
        streamId: input.streamId,
        records: input.records,
        sink,
        logger,
      });
      await recordSuccess(entry.row.id);
    } catch (error) {
      await recordFailure(entry.row.id, String(error));
      logger.warn(
        `telemetry derive: source ${entry.row.id} process failed: ${String(error)}`,
      );
    }
  }

  function dispatchForSignal(signal: TelemetrySignal): TelemetryDeriveDispatch {
    return async ({ streamId, records }) => {
      const entries = await getEntries(signal);
      // Match on the instance's configured input stream FIRST, before touching
      // `records`. Streams with no matching derive instance pay nothing - and,
      // critically, a lazy `records` thunk is never materialized for them.
      const matched = entries.filter((entry) => entry.inputStreamId === streamId);
      if (matched.length === 0) return;
      // Materialize the (possibly lazy) records exactly once, now that we know at
      // least one instance will consume them.
      const materialized = typeof records === "function" ? records() : records;
      if (materialized.length === 0) return;
      // Run matches sequentially - a batch fans out to few instances, and a
      // per-source throw is already isolated in processEntry.
      for (const entry of matched) {
        await processEntry(entry, { streamId, records: materialized });
      }
    };
  }

  return {
    dispatchForSignal,
    invalidate,
    async start() {
      if (!eventBus) return;
      try {
        unsubscribe = await eventBus.subscribe(
          pluginMetadata.pluginId,
          telemetrySourceReconcileHook,
          async () => {
            // Any source CRUD may add/remove/re-point a derive instance; drop the
            // whole cache and rebuild lazily on the next batch. Bump the
            // generation too, so a build already in flight when this fires does
            // not adopt its pre-CRUD snapshot.
            invalidate();
          },
          { mode: "broadcast" },
        );
      } catch (error) {
        logger.warn(
          `telemetry derive: failed to subscribe to source-changed hook: ${String(error)}`,
        );
      }
    },
    async stop() {
      try {
        await unsubscribe?.();
      } catch (error) {
        logger.debug(
          `telemetry derive: unsubscribe failed: ${String(error)}`,
        );
      }
    },
  };
}
