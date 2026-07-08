import React from "react";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { SystemStateBadgesSlot } from "@checkstack/catalog-common";
import { DependencyApi } from "@checkstack/dependency-common";
import { StatusBadge } from "@checkstack/ui";
import { GitBranch } from "lucide-react";
import { getBadgeLabel, getBadgeTone } from "./dependencyDisplay.logic";
import { useDependencyBadgeDataOptional } from "./DependencyBadgeDataProvider";

type Props = SlotContext<typeof SystemStateBadgesSlot>;

/**
 * Displays a dependency warning badge for a system on the dashboard.
 * Shows nothing if no upstream systems are affected.
 *
 * On the catalog browse view a `DependencyBadgeDataProvider` (installed via
 * `CatalogBrowseDependencyDataFiller`) bulk-fetches warnings for every visible
 * system; when present, the badge reads its warning from that context and
 * DISABLES its own per-system query, avoiding the browse-view N+1. On surfaces
 * without a provider (e.g. the system detail page) the fallback per-system query
 * runs exactly as before.
 *
 * Realtime updates arrive via SignalAutoInvalidator on `[["dependency"]]`,
 * including foreign-signal invalidation on SYSTEM_STATUS_CHANGED (declared in
 * the dependency plugin's `foreignSignals`).
 */
export const DependencyBadge: React.FC<Props> = ({ system }) => {
  const depClient = usePluginClient(DependencyApi);
  const badgeCtx = useDependencyBadgeDataOptional();

  const { data: ownQueryData } = depClient.getWarningsForSystem.useQuery(
    { systemId: system?.id ?? "" },
    { enabled: !!system?.id && !badgeCtx },
  );

  const data = system?.id
    ? (badgeCtx?.getWarning(system.id) ?? ownQueryData)
    : ownQueryData;

  if (!data) return;

  return (
    <StatusBadge
      tone={getBadgeTone({ state: data.derivedState })}
      icon={GitBranch}
      label={getBadgeLabel({ state: data.derivedState })}
    />
  );
};
