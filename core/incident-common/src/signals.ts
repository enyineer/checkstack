import { resolveRoute } from "@checkstack/common";
import type {
  SystemSignal,
  SystemSignalsMap,
} from "@checkstack/catalog-common";
import { incidentAccess } from "./access";
import { incidentRoutes } from "./routes";
import type { IncidentWithSystems } from "./schemas";

/**
 * Stable source id for incident-originated dashboard/system signals. Surfaced as
 * `source` on every emitted {@link SystemSignal} and used as the contributor's
 * `sourceId` in the backend `system.issues` aggregator. MUST stay in sync with
 * both the frontend `SystemSignalsSlot` filler and the backend contributor.
 */
export const INCIDENT_SIGNAL_SOURCE_ID = "incident";

/**
 * Incident severity -> signal tone. "critical" is an active breach (`error`),
 * "major" is at-risk/degraded (`warn`), "minor" is informational (`info`).
 */
const severityToTone = {
  critical: "error",
  major: "warn",
  minor: "info",
} as const;

/**
 * Incident severity -> signal label shown in the dashboard row.
 */
const severityToLabel = {
  critical: "Critical incident",
  major: "Major incident",
  minor: "Incident",
} as const;

/**
 * Pure, dependency-free deriver shared by the frontend `SystemSignalsSlot`
 * filler and the backend `system.issues` contributor. Given the active
 * incidents grouped by systemId, emit one {@link SystemSignal} per unresolved
 * incident, keyed by systemId. Systems with no unresolved incident are omitted
 * from the returned map (healthy as far as this source is concerned).
 *
 * Both callers run this SAME function so frontend and backend always produce
 * identical signals (source/tone/label/detail/href/accessRule/since/iconName).
 * The backend aggregator passes signals through and drops the frontend-only
 * fields (href/accessRule/iconName); keeping them here lets the frontend render
 * the deep-linking, permission-gated row unchanged.
 */
export function deriveIncidentSignals({
  incidentsBySystem,
  systemIds,
}: {
  /** Active incidents grouped by systemId (the bulk RPC / global query shape). */
  incidentsBySystem: Record<string, IncidentWithSystems[]>;
  /** Systems to consider, in iteration order. */
  systemIds: readonly string[];
}): SystemSignalsMap {
  const result: SystemSignalsMap = {};

  for (const systemId of systemIds) {
    const incidents = (incidentsBySystem[systemId] ?? []).filter(
      (incident) => incident.status !== "resolved",
    );
    if (incidents.length === 0) continue;

    result[systemId] = incidents.map((incident) => {
      const signal: SystemSignal = {
        source: INCIDENT_SIGNAL_SOURCE_ID,
        tone: severityToTone[incident.severity],
        label: severityToLabel[incident.severity],
        detail: incident.title,
        href: resolveRoute(incidentRoutes.routes.detail, {
          incidentId: incident.id,
        }),
        // Detail page is read-gated; render as text for users without it.
        accessRule: incidentAccess.incident.read,
        since: new Date(incident.createdAt).toISOString(),
        iconName: "TriangleAlert",
      };
      return signal;
    });
  }

  return result;
}
