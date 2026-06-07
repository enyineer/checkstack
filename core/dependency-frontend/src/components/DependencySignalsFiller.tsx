import React, { useEffect, useMemo } from "react";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import {
  SystemSignalsSlot,
  type SystemSignalsMap,
} from "@checkstack/catalog-common";
import {
  DependencyApi,
  deriveDependencySignals,
  DEPENDENCY_SIGNAL_SOURCE_ID,
} from "@checkstack/dependency-common";

type Props = SlotContext<typeof SystemSignalsSlot>;

/**
 * Reports upstream dependency problems as dashboard signals. Bulk-fetches
 * derived warnings for all overview systems and emits one signal per affected
 * system, deep-linking to the dependency map. Headless filler for
 * {@link SystemSignalsSlot}. The row->signal mapping is delegated to the shared
 * {@link deriveDependencySignals} deriver so the frontend and the backend
 * `system.issues` contributor stay in lockstep.
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
    if (!data) return {};

    // Scope the warnings to the systems this filler is responsible for before
    // deriving, so the emitted map matches the slot's requested systemIds.
    const scopedWarnings: typeof data.warnings = {};
    for (const systemId of systemIds) {
      const warning = data.warnings[systemId];
      if (warning) scopedWarnings[systemId] = warning;
    }

    return deriveDependencySignals({ warnings: scopedWarnings });
  }, [data, systemIds]);

  useEffect(() => {
    onSignals(DEPENDENCY_SIGNAL_SOURCE_ID, signals);
  }, [signals, onSignals]);

  return null;
};
