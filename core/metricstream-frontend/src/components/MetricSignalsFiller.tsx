import React from "react";
import { type SlotContext, usePluginClient } from "@checkstack/frontend-api";
import { SystemSignalsSlot } from "@checkstack/catalog-common";
import {
  MetricstreamApi,
  pluginMetadata,
} from "@checkstack/metricstream-common";
import { useLinkedStreamSignals } from "@checkstack/telemetry-frontend";
import type { LinkedStreamStatus } from "@checkstack/telemetry-common";
import {
  METRICSTREAM_SIGNAL_SOURCE_ID,
  deriveMetricstreamSignals,
} from "../lib/system-signals.logic";

type Props = SlotContext<typeof SystemSignalsSlot>;

/**
 * Adapter onto the shared deriver. Declared at module scope so it is
 * referentially stable across renders (the hook memoizes on it).
 */
const deriveSignals = (statuses: readonly LinkedStreamStatus[]) =>
  deriveMetricstreamSignals({ statuses });

/**
 * Reports linked metric streams' scrape failures / cardinality overflows as
 * dashboard signals. Headless filler for {@link SystemSignalsSlot}.
 *
 * The fetch/chunk/merge/report machinery - including the gate that keeps the
 * authenticated-only status lookup from firing for an anonymous dashboard
 * visitor - lives in the shared `useLinkedStreamSignals` hook, so all three
 * stream plugins behave identically. The status->signal transform lives in the
 * pure `deriveMetricstreamSignals` deriver so it stays unit-tested.
 */
export const MetricSignalsFiller: React.FC<Props> = ({
  systemIds,
  onSignals,
  onLoadingChange,
}) => {
  const client = usePluginClient(MetricstreamApi);

  useLinkedStreamSignals({
    pluginId: pluginMetadata.pluginId,
    sourceId: METRICSTREAM_SIGNAL_SOURCE_ID,
    systemIds,
    fetchStatuses: (args) => client.listLinkedStreamStatuses.call(args),
    deriveSignals,
    onSignals,
    onLoadingChange,
  });

  return null;
};
