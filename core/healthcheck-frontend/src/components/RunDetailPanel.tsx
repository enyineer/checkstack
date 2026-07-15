import React, { useState } from "react";
import { ExtensionSlot, usePluginClient } from "@checkstack/frontend-api";
import {
  HealthCheckApi,
  RunDetailExtrasSlot,
} from "@checkstack/healthcheck-common";
import {
  Button,
  CodeEditor,
  ErrorState,
  HealthBadge,
  Skeleton,
  Tabs,
} from "@checkstack/ui";
import { format } from "date-fns";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  SearchX,
  X,
  XCircle,
} from "lucide-react";
import { ExpandedResultView } from "./ExpandedResultView";
import { SingleRunChartGrid } from "../auto-charts";
import {
  buildAssertionGroups,
  type AssertionGroup,
} from "./assertion-display.logic";

export interface RunDetailPanelProps {
  /** The run to load and render. Fetches `getRunById` itself. */
  runId: string;
  /** Strategy id for the per-run auto-chart tiles (may still be loading). */
  strategyId?: string;
  /** Renders an X button when provided (desktop pane; a Sheet has its own). */
  onDismiss?: () => void;
  /**
   * Prev/next run navigation. An undefined handler renders that button
   * disabled; omit the whole prop to hide both buttons.
   */
  prevNext?: { onPrev?: () => void; onNext?: () => void };
}

// Read-only editors still require an onChange.
const noop = (): void => {
  return;
};

/** One assertion row: pass/fail icon, identity, expected vs actual. */
const AssertionRow: React.FC<{
  row: AssertionGroup["rows"][number];
}> = ({ row }) => (
  <li className="flex items-start gap-2 border-b border-border/40 px-3 py-2 last:border-b-0">
    {row.passed ? (
      <CheckCircle2
        className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--status-ok))]"
        aria-hidden
      />
    ) : (
      <XCircle
        className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--status-down))]"
        aria-hidden
      />
    )}
    <div className="min-w-0 flex-1">
      <p className="text-sm font-medium">
        {row.label}
        <span className="sr-only">{row.passed ? " passed" : " failed"}</span>
      </p>
      {(row.expected !== undefined || row.actual !== undefined) && (
        <p className="mt-0.5 break-all font-mono text-xs text-muted-foreground">
          {row.expected !== undefined && <>expected {row.expected}</>}
          {row.expected !== undefined && row.actual !== undefined && " · "}
          {row.actual !== undefined && <>got {row.actual}</>}
        </p>
      )}
      {!row.passed && row.message && (
        <p className="mt-0.5 text-xs text-[hsl(var(--status-down))]">
          {row.message}
        </p>
      )}
      {row.legacy && (
        <p className="mt-0.5 text-xs text-muted-foreground">
          Recorded before per-assertion outcomes; only the failure is known.
        </p>
      )}
    </div>
  </li>
);

/** The Assertions tab: per-collector groups of pass/fail rows. */
const AssertionsView: React.FC<{ groups: AssertionGroup[] }> = ({ groups }) => (
  <div className="space-y-4">
    {groups.map((group) => (
      <div key={group.collectorEntryId}>
        <div
          className="mb-2 flex flex-wrap items-baseline gap-2 border-b border-border/60 pb-2"
          title={`${group.collectorId ?? ""} · ${group.collectorEntryId}`}
        >
          <h3 className="text-sm font-medium capitalize">
            {group.collectorId?.split(".").pop() ?? group.collectorEntryId}
          </h3>
          <span
            className={
              group.failCount > 0
                ? "text-xs font-medium text-[hsl(var(--status-down))]"
                : "text-xs text-muted-foreground"
            }
          >
            {group.failCount > 0
              ? `${group.failCount} failing`
              : "all passing"}
          </span>
        </div>
        <ul className="rounded-md border border-border/60">
          {group.rows.map((row) => (
            <AssertionRow key={row.id} row={row} />
          ))}
        </ul>
      </div>
    ))}
  </div>
);

/**
 * The shared run-detail content: status header with prev/next navigation,
 * then Charts (timing waterfall + per-run metric tiles) and Raw payload tabs.
 * Chrome-free so it drops into the history split pane, a mobile Sheet, and
 * the drawer's nested sheet alike.
 */
export const RunDetailPanel: React.FC<RunDetailPanelProps> = ({
  runId,
  strategyId,
  onDismiss,
  prevNext,
}) => {
  const healthCheckClient = usePluginClient(HealthCheckApi);
  const [activeTab, setActiveTab] = useState("charts");

  // Authorization happens server-side against the run's own
  // configuration/system; an aged-out or unauthorized run resolves to
  // undefined on a SUCCESSFUL query.
  const { data: run, isLoading } = healthCheckClient.getRunById.useQuery({
    runId,
  });

  if (isLoading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="flex items-center gap-3">
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton variant="text" className="w-48" />
        </div>
        <Skeleton variant="chart" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Skeleton variant="card" />
          <Skeleton variant="card" />
        </div>
      </div>
    );
  }

  if (run === undefined) {
    return (
      <ErrorState
        icon={<SearchX className="h-10 w-10" />}
        title="Run not found"
        description="This run is no longer available. Raw runs are kept for a limited retention window; older history lives on as aggregates."
      />
    );
  }

  const assertionGroups = buildAssertionGroups({ result: run.result });
  const failingAssertions = assertionGroups.reduce(
    (sum, group) => sum + group.failCount,
    0,
  );
  const tabItems = [
    { id: "charts", label: "Charts" },
    ...(assertionGroups.length > 0
      ? [
          {
            id: "assertions",
            label:
              failingAssertions > 0
                ? `Assertions (${failingAssertions} failing)`
                : "Assertions",
          },
        ]
      : []),
    { id: "payload", label: "Raw payload" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <HealthBadge status={run.status} />
        <span className="text-sm text-muted-foreground">
          {format(new Date(run.timestamp), "PPpp")}
        </span>
        {/* Cross-plugin per-run actions (e.g. tracestream's "View trace" jump).
            Fillers self-hide when the run carries nothing for them. */}
        <ExtensionSlot slot={RunDetailExtrasSlot} context={{ run }} />
        <div className="ml-auto flex items-center gap-1">
          {prevNext && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={prevNext.onPrev}
                disabled={prevNext.onPrev === undefined}
                aria-label="Newer run"
              >
                <ChevronUp className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={prevNext.onNext}
                disabled={prevNext.onNext === undefined}
                aria-label="Older run"
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
            </>
          )}
          {onDismiss && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onDismiss}
              aria-label="Dismiss run detail"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <Tabs items={tabItems} activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === "charts" && (
        <div className="space-y-4">
          <ExpandedResultView result={run.result} />
          {strategyId && (
            <SingleRunChartGrid strategyId={strategyId} result={run.result} />
          )}
        </div>
      )}

      {activeTab === "assertions" && (
        <AssertionsView groups={assertionGroups} />
      )}

      {activeTab === "payload" && (
        <CodeEditor
          value={JSON.stringify(run.result, null, 2)}
          onChange={noop}
          language="json"
          readOnly
          minHeight="320px"
        />
      )}
    </div>
  );
};
