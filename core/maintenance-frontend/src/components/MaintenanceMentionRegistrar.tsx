import { useEffect } from "react";
import { setMentionSearch, usePluginClient } from "@checkstack/frontend-api";
import { MaintenanceApi } from "../api";
import { MAINTENANCE_MENTION_TYPE } from "../utils/mentions";
import { filterMentionCandidates } from "../utils/mention-search.logic";

/**
 * Headless component that installs maintenance search for the `#` mention
 * picker. See `IncidentMentionRegistrar` for why routing and search are
 * registered separately, and why the list is filtered in memory.
 */
export const MaintenanceMentionRegistrar = () => {
  const maintenanceClient = usePluginClient(MaintenanceApi);

  // `listMaintenances` post-filters by the caller's grants, so the picker can
  // only ever offer windows this user may read.
  const { data } = maintenanceClient.listMaintenances.useQuery({});

  useEffect(() => {
    const candidates = (data?.maintenances ?? []).map((maintenance) => ({
      id: maintenance.id,
      label: maintenance.title,
      description: `Maintenance - ${maintenance.status}`,
    }));

    setMentionSearch({
      type: MAINTENANCE_MENTION_TYPE,
      search: async ({ query }) => filterMentionCandidates({ candidates, query }),
    });
  }, [data]);

  return <></>;
};
