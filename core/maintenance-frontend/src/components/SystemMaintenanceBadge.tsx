import React, { useEffect, useState } from "react";
import { useApi, type SlotContext } from "@checkmate/frontend-api";
import { SystemStateBadgesSlot } from "@checkmate/catalog-common";
import { maintenanceApiRef } from "../api";
import type { MaintenanceWithSystems } from "@checkmate/maintenance-common";
import { Badge } from "@checkmate/ui";

type Props = SlotContext<typeof SystemStateBadgesSlot>;

/**
 * Displays a maintenance badge for a system when it has an active maintenance.
 * Shows nothing if no active maintenance.
 */
export const SystemMaintenanceBadge: React.FC<Props> = ({ system }) => {
  const api = useApi(maintenanceApiRef);
  const [hasActiveMaintenance, setHasActiveMaintenance] = useState(false);

  useEffect(() => {
    if (!system?.id) return;

    api
      .getMaintenancesForSystem({ systemId: system.id })
      .then((maintenances: MaintenanceWithSystems[]) => {
        const active = maintenances.some((m) => m.status === "in_progress");
        setHasActiveMaintenance(active);
      })
      .catch(console.error);
  }, [system?.id, api]);

  if (!hasActiveMaintenance) return;
  return <Badge variant="warning">Under Maintenance</Badge>;
};
