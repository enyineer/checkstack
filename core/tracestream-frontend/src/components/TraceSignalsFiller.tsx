import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { SystemSignalsSlot } from "@checkstack/catalog-common";
import {
  TracestreamApi,
  tracestreamAccess,
  pluginMetadata,
} from "@checkstack/tracestream-common";
import { useLinkedStreamSignals } from "@checkstack/telemetry-frontend";
import type { LinkedStreamStatus } from "@checkstack/telemetry-common";
import {
  TRACESTREAM_SIGNAL_SOURCE_ID,
  deriveTraceStreamSignals,
} from "../lib/linked-stream-signals";

type Props = SlotContext<typeof SystemSignalsSlot>;

/**
 * Adapter onto the shared deriver. Declared at module scope so it is
 * referentially stable across renders (the hook memoizes on it).
 */
const deriveSignals = (matches: readonly LinkedStreamStatus[]) =>
  deriveTraceStreamSignals({ matches, accessRule: tracestreamAccess.read });

/**
 * Reports linked trace streams' recent error spikes as dashboard signals,
 * deep-linking to the affected stream. Headless filler for
 * {@link SystemSignalsSlot}.
 *
 * The fetch/chunk/merge/report machinery - including the gate that keeps the
 * authenticated-only status lookup from firing for an anonymous dashboard
 * visitor - lives in the shared `useLinkedStreamSignals` hook, so all three
 * stream plugins behave identically. The status->signal transform lives in the
 * pure `deriveTraceStreamSignals` deriver so it stays unit-tested.
 */
export function TraceSignalsFiller({
  systemIds,
  onSignals,
  onLoadingChange,
}: Props) {
  const client = usePluginClient(TracestreamApi);

  useLinkedStreamSignals({
    pluginId: pluginMetadata.pluginId,
    sourceId: TRACESTREAM_SIGNAL_SOURCE_ID,
    systemIds,
    fetchStatuses: (args) => client.listLinkedStreamStatuses.call(args),
    deriveSignals,
    onSignals,
    onLoadingChange,
  });

  return null;
}
