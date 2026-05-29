import { createHook } from "@checkstack/backend-api";
import type { MaintenanceStatus } from "@checkstack/maintenance-common";

/**
 * Maintenance hooks for cross-plugin communication.
 * Other plugins can subscribe to these hooks to react to maintenance lifecycle events.
 * These hooks are registered as integration events for webhook subscriptions.
 *
 * `status` carries the canonical `MaintenanceStatus` enum value, so
 * automation triggers built on these hooks can offer the known values
 * for `==` comparisons in the editor.
 */
export const maintenanceHooks = {
  /**
   * Emitted when a new maintenance is created.
   * Plugins can subscribe (work-queue mode) to react to new maintenances.
   */
  maintenanceCreated: createHook<{
    maintenanceId: string;
    systemIds: string[];
    title: string;
    description?: string;
    status: MaintenanceStatus;
    startAt: string;
    endAt: string;
  }>("maintenance.created"),

  /**
   * Emitted when a maintenance is updated (info or status change).
   * Plugins can subscribe (work-queue mode) to react to updates.
   */
  maintenanceUpdated: createHook<{
    maintenanceId: string;
    systemIds: string[];
    title: string;
    description?: string;
    status: MaintenanceStatus;
    startAt: string;
    endAt: string;
    action: "updated" | "closed";
  }>("maintenance.updated"),
} as const;
