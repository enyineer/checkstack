import { createHook } from "@checkstack/backend-api";
import type {
  IncidentSeverity,
  IncidentStatus,
} from "@checkstack/incident-common";

/**
 * Incident hooks for cross-plugin communication.
 * Other plugins can subscribe to these hooks to react to incident lifecycle events.
 *
 * `severity` / `status` carry the canonical enum values
 * (`IncidentSeverity` / `IncidentStatus`) rather than loose strings, so
 * automation triggers built on these hooks can offer the known values
 * for `==` comparisons in the editor.
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
    description?: string;
    severity: IncidentSeverity;
    status: IncidentStatus;
    createdAt: string;
  }>("incident.created"),

  /**
   * Emitted when an incident is updated (info or status change).
   * Plugins can subscribe (work-queue mode) to react to updates.
   */
  incidentUpdated: createHook<{
    incidentId: string;
    systemIds: string[];
    title: string;
    description?: string;
    severity: IncidentSeverity;
    status: IncidentStatus;
    statusChange?: IncidentStatus;
  }>("incident.updated"),

  /**
   * Emitted when an incident is resolved.
   * Plugins can subscribe to clean up or log incident resolutions.
   */
  incidentResolved: createHook<{
    incidentId: string;
    systemIds: string[];
    title: string;
    severity: IncidentSeverity;
    resolvedAt: string;
  }>("incident.resolved"),
} as const;
