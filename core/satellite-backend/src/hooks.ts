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
} as const;
