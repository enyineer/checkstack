import React from "react";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { useSignal } from "@checkstack/signal-frontend";
import { SystemStateBadgesSlot } from "@checkstack/catalog-common";
import {
  DependencyApi,
  DEPENDENCY_CHANGED,
  DEPENDENCY_WARNINGS_CHANGED,
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
 * Listens for realtime updates via signals.
 */
export const DependencyBadge: React.FC<Props> = ({ system }) => {
  const depClient = usePluginClient(DependencyApi);

  const { data, refetch } = depClient.getWarningsForSystem.useQuery(
    { systemId: system?.id ?? "" },
    { enabled: !!system?.id },
  );

  // Listen for dependency changes
  useSignal(DEPENDENCY_CHANGED, () => {
    void refetch();
  });

  // Listen for warning re-evaluations
  useSignal(DEPENDENCY_WARNINGS_CHANGED, ({ affectedSystemIds }) => {
    if (system?.id && affectedSystemIds.includes(system.id)) {
      void refetch();
    }
  });

  if (!data) return;

  return (
    <Badge variant={getBadgeVariant(data.derivedState)}>
      {getBadgeLabel(data.derivedState)}
    </Badge>
  );
};
