import { createHook } from "@checkmate-monitor/backend-api";

/**
 * Incident hooks for cross-plugin communication.
 * Other plugins can subscribe to these hooks to react to incident lifecycle events.
 */
export const incidentHooks = {
  /**
   * Emitted when a new incident is created.
   * Plugins can subscribe (work-queue mode) to react to new incidents.
   */
  incidentCreated: createHook<{
    incidentId: string;
    systemIds: string[];
    title: string;
    severity: string;
  }>("incident.created"),

  /**
   * Emitted when an incident is updated (info or status change).
   * Plugins can subscribe (work-queue mode) to react to updates.
   */
  incidentUpdated: createHook<{
    incidentId: string;
    systemIds: string[];
    statusChange?: string;
  }>("incident.updated"),

  /**
   * Emitted when an incident is resolved.
   * Plugins can subscribe to clean up or log incident resolutions.
   */
  incidentResolved: createHook<{
    incidentId: string;
    systemIds: string[];
  }>("incident.resolved"),
} as const;
