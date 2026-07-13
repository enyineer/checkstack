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

/**
 * Fired (via `notifyCapabilityConfigChanged`) when a domain plugin's capability
 * configuration for a satellite changes (e.g. a scrape-target CRUD mutation).
 *
 * satellite-backend subscribes in `broadcast` mode so EVERY pod receives it and
 * re-pushes `capability_config` to its OWN connected satellites - mirroring the
 * script-packages / sandbox-policy relays. Best-effort liveness; the config is
 * rebuilt fresh from the domain plugin's durable tables on the next connect
 * regardless, so a missed event self-heals.
 */
export const satelliteCapabilityConfigChangedHook = createHook<{
  kind: string;
  satelliteId?: string;
}>("satellite.capabilityConfigChanged");
