import { isAccessRuleSatisfied } from "@checkstack/common";
import {
  principalGrantedRuleIds,
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
 * AI tool. Mirrors the frontend `SystemSignalsSlot` filler: emits one signal
 * per OPEN incident for EVERY system globally, keyed by systemId, via the SAME
 * shared `deriveIncidentSignals` deriver so frontend and backend agree.
 *
 * Per-source security gate: a principal lacking `incident.read` gets `{}` (never
 * a throw). The global read resolves from the authoritative incident tables, so
 * the answer is identical on every pod (state-and-scale rule).
 */
export function createIncidentSignalsContributor({
  service,
}: {
  service: SignalsService;
}): SystemSignalsContributor {
  return {
    sourceId: INCIDENT_SIGNAL_SOURCE_ID,
    read: async ({ principal }) => {
      if (
        !isAccessRuleSatisfied(
          principalGrantedRuleIds(principal),
          incidentAccess.incident.read,
        )
      ) {
        return { accessible: false, signals: {} };
      }

      const incidentsBySystem = await service.listOpenIncidentsBySystem();
      return {
        accessible: true,
        signals: deriveIncidentSignals({
          incidentsBySystem,
          systemIds: Object.keys(incidentsBySystem),
        }),
      };
    },
  };
}
