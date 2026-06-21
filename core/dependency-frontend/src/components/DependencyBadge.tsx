import React from "react";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { SystemStateBadgesSlot } from "@checkstack/catalog-common";
import { DependencyApi } from "@checkstack/dependency-common";
import { StatusBadge } from "@checkstack/ui";
import { GitBranch } from "lucide-react";
import { getBadgeLabel, getBadgeTone } from "./dependencyDisplay.logic";

type Props = SlotContext<typeof SystemStateBadgesSlot>;

/**
 * Displays a dependency warning badge for a system on the dashboard.
 * Shows nothing if no upstream systems are affected.
 *
 * Realtime updates arrive via SignalAutoInvalidator on `[["dependency"]]`,
 * including foreign-signal invalidation on SYSTEM_STATUS_CHANGED (declared in
 * the dependency plugin's `foreignSignals`).
 */
export const DependencyBadge: React.FC<Props> = ({ system }) => {
  const depClient = usePluginClient(DependencyApi);

  const { data } = depClient.getWarningsForSystem.useQuery(
    { systemId: system?.id ?? "" },
    { enabled: !!system?.id },
  );

  if (!data) return;

  return (
    <StatusBadge
      tone={getBadgeTone({ state: data.derivedState })}
      icon={GitBranch}
      label={getBadgeLabel({ state: data.derivedState })}
    />
  );
};
