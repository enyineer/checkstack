import { createHook } from "@checkstack/backend-api";

/**
 * Satellite hooks for cross-plugin communication.
 *
 * The connection-lifecycle hooks (`satellite.connected` / `.disconnected` /
 * `.heartbeat_lost`) were removed in Phase 4 (reactive automation engine
 * §10.6): satellite connection state is now the reactive
 * `satellite-connection` entity (see `./entity.ts`), and the equivalent
 * trigger events are derived from its changes.
 *
 * `satellite.removed` stays — it is a deletion/cleanup signal (consumed by
 * healthcheck-backend to scrub the satellite's id), not entity state.
 */
export const satelliteHooks = {
  /**
   * Emitted when a satellite is deleted.
   * Healthcheck-backend subscribes to scrub this satellite's ID
   * from all systemHealthChecks.satelliteIds arrays.
   */
  satelliteRemoved: createHook<{
    satelliteId: string;
  }>("satellite.removed"),
} as const;
