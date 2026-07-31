import { useEffect } from "react";
import {
  filterMentionCandidates,
  setMentionResolve,
  setMentionSearch,
  usePluginClient,
} from "@checkstack/frontend-api";
import { MaintenanceApi } from "../api";
import { MAINTENANCE_MENTION_TYPE } from "../utils/mentions";

/**
 * Headless component that installs maintenance search for the `#` mention
 * picker, plus the VIEWABILITY half that decides whether an already-written
 * reference renders as a link. See `IncidentMentionRegistrar` for why routing,
 * search and viewability are registered separately, why the list is filtered in
 * memory, and why viewability does not reuse the search list.
 */
export const MaintenanceMentionRegistrar = () => {
  const maintenanceClient = usePluginClient(MaintenanceApi);

  // `listMaintenances` post-filters by the caller's grants, so the picker can
  // only ever offer windows this user may read.
  //
  // COMPLETED and CANCELLED windows are included, for the same reason resolved
  // incidents are (see `IncidentMentionRegistrar`): a finished window is a
  // perfectly normal thing to reference afterwards.
  // `filterMentionCandidates` sorts them behind everything still live.
  const { data } = maintenanceClient.listMaintenances.useQuery({
    includeCompleted: true,
  });

  useEffect(() => {
    const candidates = (data?.maintenances ?? []).map((maintenance) => ({
      id: maintenance.id,
      label: maintenance.title,
      description: `Maintenance - ${maintenance.status}`,
      // `scheduled` and `in_progress` are live; a completed or cancelled
      // window is done with.
      isActive:
        maintenance.status === "scheduled" ||
        maintenance.status === "in_progress",
    }));

    setMentionSearch({
      type: MAINTENANCE_MENTION_TYPE,
      search: async ({ query }) => filterMentionCandidates({ candidates, query }),
    });
  }, [data]);

  // Installed once: it closes over the CLIENT, not over query data.
  useEffect(() => {
    setMentionResolve({
      type: MAINTENANCE_MENTION_TYPE,
      resolveRefs: async ({ ids }) => {
        const result = await maintenanceClient.resolveMaintenanceRefs.call({
          ids,
        });
        return result.maintenances.map((maintenance) => maintenance.id);
      },
    });
  }, [maintenanceClient]);

  return <></>;
};
