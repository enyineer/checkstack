import { createHook } from "@checkstack/backend-api";

/**
 * Satellite hooks for cross-plugin communication.
 * Other plugins (e.g., healthcheck-backend) can subscribe to clean up
 * when a satellite is removed.
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

  /**
   * Emitted when a satellite WebSocket completes authentication and
   * registers itself in the in-memory connection map.
   */
  connected: createHook<{
    satelliteId: string;
    name: string;
    region: string;
    timestamp: string;
  }>("satellite.connected"),

  /**
   * Emitted when a previously-connected satellite's WebSocket closes
   * (graceful or otherwise). Distinct from `heartbeatLost`: this fires
   * the moment the socket drops, regardless of whether the satellite
   * comes back within the heartbeat window.
   */
  disconnected: createHook<{
    satelliteId: string;
    name: string;
    region: string;
    timestamp: string;
  }>("satellite.disconnected"),

  /**
   * Emitted by the heartbeat monitor when a satellite's status
   * transitions from `online` to `offline` — i.e. no heartbeat for
   * longer than `OFFLINE_THRESHOLD_MS`. Used by automations that
   * page on stale satellites.
   */
  heartbeatLost: createHook<{
    satelliteId: string;
    name: string;
    region: string;
    timestamp: string;
  }>("satellite.heartbeat_lost"),
} as const;
