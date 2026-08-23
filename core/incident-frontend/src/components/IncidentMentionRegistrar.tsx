import { useEffect } from "react";
import {
  filterMentionCandidates,
  setMentionResolve,
  setMentionSearch,
  usePluginClient,
} from "@checkstack/frontend-api";
import { IncidentApi } from "../api";
import { INCIDENT_MENTION_TYPE } from "../utils/mentions";

/**
 * Headless component that installs incident search for the `#` mention picker.
 *
 * The routing half of the provider is registered at module scope (see
 * `utils/mentions.ts`), which is what every already-written mention needs to
 * RENDER. Search needs data, and data needs React - hence this component. It
 * renders nothing and is mounted once via a slot.
 *
 * The list is fetched ONCE and filtered in memory rather than re-queried per
 * keystroke: a picker that issues a request per character is both slow and a
 * needless load multiplier, and the candidate set here is small.
 *
 * It also installs the VIEWABILITY half, which decides whether an already-
 * written reference renders as a link. That deliberately does NOT reuse the
 * search list above: the list is shaped for authoring (it is capped at
 * `MAX_MENTION_RESULTS`, and any future pagination would hide more), so a
 * reference absent from it is not evidence the reader cannot open it.
 * `resolveIncidentRefs` answers from the ids themselves.
 */
export const IncidentMentionRegistrar = () => {
  const incidentClient = usePluginClient(IncidentApi);

  // `listIncidents` post-filters by the caller's grants, so the picker can only
  // ever offer incidents this user may read. Offering a title they cannot see
  // would leak it whether or not they pick it.
  //
  // RESOLVED incidents are included: referencing a past incident from a
  // follow-up ("recurrence of #Checkout outage") is a normal thing to write,
  // and excluding them made those references impossible to author even though
  // they render perfectly well. `filterMentionCandidates` sorts them behind
  // everything still open so they cannot crowd out live incidents.
  const { data } = incidentClient.listIncidents.useQuery({
    includeResolved: true,
  });

  useEffect(() => {
    const candidates = (data?.incidents ?? []).map((incident) => ({
      id: incident.id,
      label: incident.title,
      description: `Incident - ${incident.status}`,
      isActive: incident.status !== "resolved",
    }));

    setMentionSearch({
      type: INCIDENT_MENTION_TYPE,
      search: async ({ query }) => filterMentionCandidates({ candidates, query }),
    });
  }, [data]);

  // Installed once: it closes over the CLIENT, not over query data, so it must
  // not be re-installed whenever the incident list refetches.
  // eslint-disable-next-line checkstack/no-state-seed-in-effect -- this registers a global mention resolver, not editable component state; keep the client dependency so a changed client gets a current resolver.
  useEffect(() => {
    setMentionResolve({
      type: INCIDENT_MENTION_TYPE,
      resolveRefs: async ({ ids }) => {
        const result = await incidentClient.resolveIncidentRefs.call({ ids });
        return result.incidents.map((incident) => incident.id);
      },
    });
  }, [incidentClient]);

  return <></>;
};
