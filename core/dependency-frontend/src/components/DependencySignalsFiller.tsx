import React, { useEffect, useMemo } from "react";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { resolveRoute } from "@checkstack/common";
import {
  SystemSignalsSlot,
  type SystemSignal,
  type SystemSignalsMap,
} from "@checkstack/catalog-common";
import {
  DependencyApi,
  dependencyRoutes,
  dependencyAccess,
  type DerivedState,
} from "@checkstack/dependency-common";

type Props = SlotContext<typeof SystemSignalsSlot>;

const SOURCE_ID = "dependency";

const stateToTone: Record<DerivedState, SystemSignal["tone"]> = {
  down: "error",
  degraded: "warn",
  info: "info",
};

const stateToLabel: Record<DerivedState, string> = {
  down: "Upstream down",
  degraded: "Upstream degraded",
  info: "Dependency info",
};

/**
 * Reports upstream dependency problems as dashboard signals. Bulk-fetches
 * derived warnings for all overview systems and emits one signal per affected
 * system, deep-linking to the dependency map. Headless filler for
 * {@link SystemSignalsSlot}.
 */
export const DependencySignalsFiller: React.FC<Props> = ({
  systemIds,
  onSignals,
}) => {
  const depClient = usePluginClient(DependencyApi);

  const { data } = depClient.getWarnings.useQuery(
    { systemIds },
    { enabled: systemIds.length > 0, staleTime: 30_000 },
  );

  const signals = useMemo<SystemSignalsMap>(() => {
    const result: SystemSignalsMap = {};
    if (!data) return result;

    for (const systemId of systemIds) {
      const warning = data.warnings[systemId];
      if (!warning) continue;

      const upstreamCount = warning.affectedUpstreams.length;
      const signal: SystemSignal = {
        source: SOURCE_ID,
        tone: stateToTone[warning.derivedState],
        label: stateToLabel[warning.derivedState],
        detail:
          upstreamCount > 0
            ? `${upstreamCount} upstream ${upstreamCount === 1 ? "system" : "systems"} affected`
            : undefined,
        href: resolveRoute(dependencyRoutes.routes.map),
        // The dependency map is gated by its own rule; users who can see the
        // warning (dependency.read) but not the map get plain text, not a link.
        accessRule: dependencyAccess.map,
        iconName: "GitBranch",
      };
      result[systemId] = [signal];
    }
    return result;
  }, [data, systemIds]);

  useEffect(() => {
    onSignals(SOURCE_ID, signals);
  }, [signals, onSignals]);

  return null;
};
