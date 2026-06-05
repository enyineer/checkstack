import React from "react";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { SystemStateBadgesSlot } from "@checkstack/catalog-common";
import {
  DependencyApi,
  type DerivedState,
} from "@checkstack/dependency-common";
import { StatusBadge, type StatusTone } from "@checkstack/ui";
import { GitBranch } from "lucide-react";

type Props = SlotContext<typeof SystemStateBadgesSlot>;

function getBadgeTone(state: DerivedState): StatusTone {
  switch (state) {
    case "down": {
      return "error";
    }
    case "degraded": {
      return "warn";
    }
    default: {
      return "info";
    }
  }
}

function getBadgeLabel(state: DerivedState): string {
  switch (state) {
    case "down": {
      return "Upstream down";
    }
    case "degraded": {
      return "Upstream degraded";
    }
    default: {
      return "Dependency info";
    }
  }
}

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
      tone={getBadgeTone(data.derivedState)}
      icon={GitBranch}
      label={getBadgeLabel(data.derivedState)}
    />
  );
};
