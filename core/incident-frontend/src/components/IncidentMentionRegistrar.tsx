import { useEffect } from "react";
import { setMentionSearch, usePluginClient } from "@checkstack/frontend-api";
import { IncidentApi } from "../api";
import { INCIDENT_MENTION_TYPE } from "../utils/mentions";
import { filterMentionCandidates } from "../utils/mention-search.logic";

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
 */
export const IncidentMentionRegistrar = () => {
  const incidentClient = usePluginClient(IncidentApi);

  // `listIncidents` post-filters by the caller's grants, so the picker can only
  // ever offer incidents this user may read. Offering a title they cannot see
  // would leak it whether or not they pick it.
  const { data } = incidentClient.listIncidents.useQuery({});

  useEffect(() => {
    const candidates = (data?.incidents ?? []).map((incident) => ({
      id: incident.id,
      label: incident.title,
      description: `Incident - ${incident.status}`,
    }));

    setMentionSearch({
      type: INCIDENT_MENTION_TYPE,
      search: async ({ query }) => filterMentionCandidates({ candidates, query }),
    });
  }, [data]);

  return <></>;
};
