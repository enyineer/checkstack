import React from "react";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { SystemSignalsSlot } from "@checkstack/catalog-common";
import { LogstreamApi, pluginMetadata } from "@checkstack/logstream-common";
import { useLinkedStreamSignals } from "@checkstack/telemetry-frontend";
import type { LinkedStreamStatus } from "@checkstack/telemetry-common";
import {
  LOGSTREAM_SIGNAL_SOURCE_ID,
  deriveLogstreamSignals,
} from "../lib/system-signals.logic";

type Props = SlotContext<typeof SystemSignalsSlot>;

/**
 * Adapter onto the shared deriver. Declared at module scope so it is
 * referentially stable across renders (the hook memoizes on it).
 */
const deriveSignals = (statuses: readonly LinkedStreamStatus[]) =>
  deriveLogstreamSignals({ statuses });

/**
 * Reports linked log streams' error spikes as dashboard signals. Headless
 * filler for {@link SystemSignalsSlot}.
 *
 * The fetch/chunk/merge/report machinery - including the gate that keeps the
 * authenticated-only status lookup from firing for an anonymous dashboard
 * visitor - lives in the shared `useLinkedStreamSignals` hook, so all three
 * stream plugins behave identically. The status->signal transform lives in the
 * pure `deriveLogstreamSignals` deriver so it stays unit-tested.
 */
export const LogSignalsFiller: React.FC<Props> = ({
  systemIds,
  onSignals,
  onLoadingChange,
}) => {
  const client = usePluginClient(LogstreamApi);

  useLinkedStreamSignals({
    pluginId: pluginMetadata.pluginId,
    sourceId: LOGSTREAM_SIGNAL_SOURCE_ID,
    systemIds,
    fetchStatuses: (args) => client.listLinkedStreamStatuses.call(args),
    deriveSignals,
    onSignals,
    onLoadingChange,
  });

  return null;
};
