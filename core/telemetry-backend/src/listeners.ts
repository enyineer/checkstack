/**
 * Pod-local listener lifecycle manager.
 *
 * A "listener" source type holds a long-lived inbound socket (syslog, a TCP
 * collector) that physically lives on ONE pod. This manager runs one listener
 * per ENABLED listener-mode instance ON THIS POD, keyed in a pod-local Map of
 * `sourceId -> stop handle`.
 *
 * STATE & SCALE (see `.claude/rules/state-and-scale.md`): the handle Map is
 * genuinely pod-local INFRASTRUCTURE - a socket this pod holds - NOT a queryable
 * source of truth. The durable truth is the `telemetry_sources` row; each pod
 * independently starts a listener for every enabled instance (a listener that
 * binds a shared port will fail on all-but-one pod with `EADDRINUSE`, recorded
 * as `lastError` - that is expected for a single-bind listener and does not
 * crash boot). Cross-pod convergence rides the `telemetrySourceChangedHook`
 * (broadcast): every pod reconciles the affected source on create/update/delete,
 * so a newly-enabled listener starts, a disabled/deleted one stops, and a config
 * change restarts - everywhere at once.
 *
 * PARALLEL INSTANCES (see `.claude/rules/pr-preview.md`): a listener binds a
 * host port, which - unlike redis/queue state - cannot be namespaced. A
 * secondary (namespaced) instance shares the host with the default dev instance,
 * so it would RACE it for the same listener ports. The manager therefore starts
 * NO listeners at all on a non-default instance (the semantics the deleted
 * logstream syslog listener carried per-listener, re-homed here so it covers
 * EVERY listener source type uniformly).
 */

import type { Logger, InstanceRuntime } from "@checkstack/backend-api";
import type { EventBus, HookUnsubscribe } from "@checkstack/backend-api";
import { pluginMetadata, type SourceBinding } from "@checkstack/telemetry-common";
import { createBoundSink } from "./bound-sink";
import { resolveRunnableConfig } from "./service";
import { truncateError } from "./runner";
import { telemetrySourceReconcileHook } from "./events";
import type { SourceSecretStore } from "./secrets";
import type {
  RegisteredTelemetrySourceType,
  TelemetrySinkRegistry,
  TelemetrySourceRegistry,
} from "./extension-points";

/** The row shape a listener needs to start. */
export interface ListenerRow {
  id: string;
  sourceTypeId: string;
  enabled: boolean;
  config: Record<string, unknown>;
  bindings: SourceBinding[];
}

/**
 * Seam over the shared row: enumerate startable rows, load one, and record a
 * start failure. DB-backed in setup, faked in tests.
 */
export interface ListenerStore {
  /** Every ENABLED instance (the manager filters to those with a listener seam). */
  listStartable(): Promise<ListenerRow[]>;
  get(sourceId: string): Promise<ListenerRow | null>;
  markFailure(input: {
    sourceId: string;
    at: Date;
    error: string;
  }): Promise<void>;
}

export interface ListenerManager {
  /** Start enabled listeners on this pod and subscribe to the convergence hook. */
  start(): Promise<void>;
  /** Stop every listener on this pod and unsubscribe. */
  stop(): Promise<void>;
  /** Reconcile ONE source (stop, then start if it should run). Exposed for tests. */
  reconcileSource(input: { sourceId: string }): Promise<void>;
}

export function createListenerManager({
  store,
  sourceRegistry,
  sinkRegistry,
  secretStore,
  instanceRuntime,
  eventBus,
  logger,
  now = () => new Date(),
}: {
  store: ListenerStore;
  sourceRegistry: TelemetrySourceRegistry;
  sinkRegistry: TelemetrySinkRegistry;
  secretStore: SourceSecretStore;
  /** Tells the manager whether it runs as the default instance; a namespaced
   * secondary instance starts NO listeners (host-port isolation). */
  instanceRuntime: InstanceRuntime;
  eventBus?: EventBus;
  logger: Logger;
  now?: () => Date;
}): ListenerManager {
  /** Pod-local: sourceId -> stop handle for a listener THIS pod holds. */
  const handles = new Map<string, () => void | Promise<void>>();
  let unsubscribe: HookUnsubscribe | null = null;

  async function stopHandle(sourceId: string): Promise<void> {
    const stop = handles.get(sourceId);
    if (!stop) return;
    handles.delete(sourceId);
    try {
      await stop();
    } catch (error) {
      logger.warn(
        `telemetry: listener stop failed for ${sourceId}: ${String(error)}`,
      );
    }
  }

  async function startListener({
    row,
    type,
  }: {
    row: ListenerRow;
    type: RegisteredTelemetrySourceType;
  }): Promise<void> {
    try {
      const config = await resolveRunnableConfig({
        type,
        config: row.config,
        sourceId: row.id,
        secretStore,
      });
      const { sink } = createBoundSink({
        bindings: row.bindings,
        sinkRegistry,
        sourceRef: { sourceId: row.id, sourceTypeId: row.sourceTypeId },
      });
      const stop = await type.listener!.start({ config, sink, logger });
      handles.set(row.id, stop);
    } catch (error) {
      // A start failure (EADDRINUSE, bad config) is recorded, never fatal.
      await store.markFailure({
        sourceId: row.id,
        at: now(),
        error: truncateError(`listener start failed: ${String(error)}`),
      });
      logger.warn(
        `telemetry: listener start failed for ${row.id}: ${String(error)}`,
      );
    }
  }

  async function reconcileSource({
    sourceId,
  }: {
    sourceId: string;
  }): Promise<void> {
    // Stop any current listener first, so a config change restarts cleanly and a
    // disable/delete simply stops.
    await stopHandle(sourceId);
    const row = await store.get(sourceId);
    if (!row || !row.enabled) return;
    const type = sourceRegistry.get(row.sourceTypeId);
    if (!type?.listener) return;
    await startListener({ row, type });
  }

  return {
    reconcileSource,
    async start() {
      // A namespaced secondary instance (PR preview) shares the host with the
      // default instance; host-bound listener ports cannot be namespaced, so it
      // starts none - and does NOT subscribe to the convergence hook, so a later
      // source CRUD cannot start one on this instance either.
      if (!instanceRuntime.isDefault) {
        logger.info(
          "telemetry: listeners not started on a secondary instance (port isolation)",
        );
        return;
      }
      const rows = await store.listStartable();
      for (const row of rows) {
        if (!row.enabled) continue;
        const type = sourceRegistry.get(row.sourceTypeId);
        if (!type?.listener) continue;
        await startListener({ row, type });
      }
      if (eventBus) {
        try {
          unsubscribe = await eventBus.subscribe(
            pluginMetadata.pluginId,
            telemetrySourceReconcileHook,
            async ({ sourceId }) => {
              await reconcileSource({ sourceId });
            },
            { mode: "broadcast" },
          );
        } catch (error) {
          logger.warn(
            `telemetry: listener manager failed to subscribe to source-changed hook: ${String(error)}`,
          );
        }
      }
    },
    async stop() {
      try {
        await unsubscribe?.();
      } catch (error) {
        logger.debug(
          `telemetry: listener manager unsubscribe failed: ${String(error)}`,
        );
      }
      // Deleting the current key during Map iteration is well-defined and safe;
      // stopHandle removes exactly the key it was handed.
      for (const sourceId of handles.keys()) {
        await stopHandle(sourceId);
      }
    },
  };
}
