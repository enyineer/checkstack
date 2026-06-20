import React from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@checkstack/ui";
import { AutomationApi } from "@checkstack/automation-common";
import { extractErrorMessage } from "@checkstack/common";

export interface RunReplayPickerProps {
  /** Automation whose runs populate the picker. */
  automationId: string;
  /**
   * Called with the reconstructed sample-context JSON once a run is
   * selected and its scope is fetched. The parent applies it to the
   * `ContextSampleEditor`.
   */
  onLoad: (sampleContextJson: string) => void;
  /** Surfaces a warning when the picked run's durable scope was cleared. */
  onScopeSnapshotMissing?: () => void;
}

/**
 * "Load from run" dropdown for the script-test panel. Lists this
 * automation's recent runs; selecting one fetches its reconstructed
 * scope via `getRunScopeForReplay` and hands the JSON to `onLoad`.
 *
 * Lives in automation-frontend (owns the RPC); `@checkstack/ui` stays
 * plugin-agnostic and only renders it through the `runPicker` slot.
 */
export const RunReplayPicker: React.FC<RunReplayPickerProps> = ({
  automationId,
  onLoad,
  onScopeSnapshotMissing,
}) => {
  const client = usePluginClient(AutomationApi);
  const [selectedRunId, setSelectedRunId] = React.useState<string | null>(null);

  const runsQuery = client.listRuns.useQuery(
    { automationId, limit: 25 },
    { enabled: Boolean(automationId) },
  );

  const replayQuery = client.getRunScopeForReplay.useQuery(
    { runId: selectedRunId ?? "" },
    { enabled: Boolean(selectedRunId), gcTime: 0 },
  );

  // Apply the fetched scope once it resolves for the selected run.
  React.useEffect(() => {
    if (!selectedRunId || !replayQuery.data) return;
    onLoad(JSON.stringify(replayQuery.data.context, null, 2));
    if (!replayQuery.data.scopeSnapshotAvailable) {
      onScopeSnapshotMissing?.();
    }
    // Reset so the same run can be re-picked later.
    setSelectedRunId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- apply once per fetch; callbacks are stable enough and re-running on their identity would double-apply
  }, [selectedRunId, replayQuery.data]);

  const runs = runsQuery.data?.items ?? [];

  return (
    <Select
      value=""
      onValueChange={(runId) => setSelectedRunId(runId)}
      disabled={runs.length === 0 || replayQuery.isFetching}
    >
      <SelectTrigger className="h-7 w-[180px] text-xs">
        <SelectValue
          placeholder={
            replayQuery.isFetching
              ? "Loading…"
              : runs.length === 0
                ? "No runs yet"
                : "Load from run"
          }
        />
      </SelectTrigger>
      <SelectContent>
        {runs.map((run) => (
          <SelectItem key={run.id} value={run.id}>
            {new Date(run.startedAt).toLocaleString()} - {run.status}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

/** Format a replay-load error for surfacing in the panel. */
export function formatReplayError(error: unknown): string {
  return `Failed to load run scope: ${extractErrorMessage(error)}`;
}
