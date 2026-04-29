import React from "react";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { SystemStateBadgesSlot } from "@checkstack/catalog-common";
import {
  DependencyApi,
  type DerivedState,
} from "@checkstack/dependency-common";
import { Badge } from "@checkstack/ui";

type Props = SlotContext<typeof SystemStateBadgesSlot>;

function getBadgeVariant(
  state: DerivedState,
): "info" | "warning" | "destructive" {
  switch (state) {
    case "down": {
      return "destructive";
    }
    case "degraded": {
      return "warning";
    }
    default: {
      return "info";
    }
  }
}

function getBadgeLabel(state: DerivedState): string {
  switch (state) {
    case "down": {
      return "Upstream Down";
    }
    case "degraded": {
      return "Upstream Degraded";
    }
    default: {
      return "Dep. Info";
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
    <Badge variant={getBadgeVariant(data.derivedState)}>
      {getBadgeLabel(data.derivedState)}
    </Badge>
  );
};
