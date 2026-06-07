import {
  createGatedSystemSignalsContributor,
  type SystemAccessResolver,
  type SystemSignalsContributor,
} from "@checkstack/ai-backend";
import {
  incidentAccess,
  INCIDENT_SIGNAL_SOURCE_ID,
  deriveIncidentSignals,
} from "@checkstack/incident-common";
import type { IncidentService } from "./service";

/** The slice of `IncidentService` the contributor needs - eases testing. */
type SignalsService = Pick<IncidentService, "listOpenIncidentsBySystem">;

/**
 * Build the incident `SystemSignalsContributor` for the backend `system.issues`
 * AI tool. Reads OPEN incidents for every system globally and runs the SAME
 * shared `deriveIncidentSignals` deriver the dashboard filler uses, so frontend
 * and backend signals match. The per-source access gate (global rule plus
 * per-system team grants) is applied by
 * {@link createGatedSystemSignalsContributor}; the global read resolves from the
 * authoritative incident tables, so the answer is identical on every pod.
 */
export function createIncidentSignalsContributor({
  service,
  resolver,
}: {
  service: SignalsService;
  resolver: SystemAccessResolver;
}): SystemSignalsContributor {
  return createGatedSystemSignalsContributor({
    sourceId: INCIDENT_SIGNAL_SOURCE_ID,
    accessRule: incidentAccess.incident.read,
    resolver,
    readSignals: async () => {
      const incidentsBySystem = await service.listOpenIncidentsBySystem();
      return deriveIncidentSignals({
        incidentsBySystem,
        systemIds: Object.keys(incidentsBySystem),
      });
    },
  });
}
