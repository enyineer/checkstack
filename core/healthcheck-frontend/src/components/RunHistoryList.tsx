import React from "react";
import { Skeleton, VirtualList, cn } from "@checkstack/ui";
import { format } from "date-fns";
import { Archive } from "lucide-react";
import type { AggregatedBucket } from "@checkstack/healthcheck-common";
import type { RunHistoryRow } from "./runHistoryRows.logic";
import {
  RunEnvironmentChip,
  RunSourceChip,
  RunTimestamp,
  type EnvironmentLabel,
  type HealthCheckRunDetailed,
} from "./HealthCheckRunsTable";
import { HealthStatusPill } from "./HealthStatusPill";
import {
  statusToLabel,
  statusToTone,
  toneStyles,
  type StatusTone,
} from "./healthcheckDisplay.logic";

export interface RunHistoryListProps {
  rows: RunHistoryRow<HealthCheckRunDetailed>[];
  selectedRunId?: string;
  onSelectRun: (props: { runId: string }) => void;
  /** ArrowUp/ArrowDown from within the list (prev = newer, next = older). */
  onKeyNavigate: (props: { direction: "prev" | "next" }) => void;
  loading: boolean;
  /** Dim rows while a refetch is in flight (stale-while-revalidate). */
  isStale: boolean;
  /**
   * EVERY environment in the instance. Required for the same reason as on
   * `HealthCheckRunsTable`: an id missing from this list is rendered as
   * "Removed environment", which is only true if the full list was supplied.
   */
  environmentLabels: EnvironmentLabel[];
  emptyMessage: string;
  /** Height classes for the scroll container. */
  className?: string;
}

/** Tone for an aggregate bucket: honest about any failures in the window. */
function bucketTone(bucket: AggregatedBucket): StatusTone {
  if (bucket.degradedCount === 0 && bucket.unhealthyCount === 0) return "ok";
  return bucket.successRate >= 90 ? "warn" : "down";
}

function estimateRowSize({
  item,
}: {
  item: RunHistoryRow<HealthCheckRunDetailed>;
}): number {
  switch (item.kind) {
    case "run": {
      return 68;
    }
    case "retentionDivider": {
      return 40;
    }
    default: {
      return 56;
    }
  }
}

function rowKey({
  item,
}: {
  item: RunHistoryRow<HealthCheckRunDetailed>;
}): string {
  switch (item.kind) {
    case "run": {
      return `run-${item.run.id}`;
    }
    case "retentionDivider": {
      return "retention-divider";
    }
    default: {
      return `agg-${new Date(item.bucket.bucketStart).getTime()}`;
    }
  }
}

/**
 * The master list of the run-history split view: a virtualized column of run
 * rows, ending (on the last page) with the retention divider and the
 * aggregate buckets that survive it. Run rows are keyboard-operable
 * (Enter/Space select, ArrowUp/ArrowDown walk runs); aggregate rows are
 * informational only — there is no per-run detail behind them.
 */
export const RunHistoryList: React.FC<RunHistoryListProps> = ({
  rows,
  selectedRunId,
  onSelectRun,
  onKeyNavigate,
  loading,
  isStale,
  environmentLabels,
  emptyMessage,
  className,
}) => {
  const envNameById = new Map(
    environmentLabels.map((e) => [e.id, e.name]),
  );

  const firstRunId = rows.find((r) => r.kind === "run")?.run.id;
  const selectedIndex = rows.findIndex(
    (r) => r.kind === "run" && r.run.id === selectedRunId,
  );

  if (loading && rows.length === 0) {
    return (
      <div className={cn("space-y-2", className)} aria-busy="true">
        <Skeleton variant="row" />
        <Skeleton variant="row" />
        <Skeleton variant="row" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground",
          className,
        )}
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <div
      className={cn(isStale && "opacity-50", className)}
      onKeyDown={(event) => {
        if (event.key === "ArrowUp") {
          event.preventDefault();
          onKeyNavigate({ direction: "prev" });
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          onKeyNavigate({ direction: "next" });
        }
      }}
    >
      <VirtualList
        items={rows}
        getKey={rowKey}
        estimateSize={estimateRowSize}
        scrollToIndex={selectedIndex === -1 ? undefined : selectedIndex}
        className="h-full rounded-md border"
        renderItem={({ item }) => {
          switch (item.kind) {
            case "run": {
              const run = item.run;
              const tone = statusToTone({ status: run.status });
              const selected = run.id === selectedRunId;
              // Roving tabindex: the selected run (or the first when none is
              // selected) is the list's single tab stop.
              const isTabStop = selected || (!selectedRunId && run.id === firstRunId);
              return (
                <div
                  role="button"
                  tabIndex={isTabStop ? 0 : -1}
                  aria-current={selected ? "true" : undefined}
                  onClick={() => onSelectRun({ runId: run.id })}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    onSelectRun({ runId: run.id });
                  }}
                  className={cn(
                    "relative cursor-pointer border-b border-border/60 px-3 py-2 transition-colors hover:bg-surface-inset",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    selected && "bg-surface-inset",
                  )}
                >
                  {selected && (
                    <span
                      className={cn(
                        "absolute inset-y-0 left-0 w-1",
                        toneStyles[tone].accent,
                      )}
                      aria-hidden
                    />
                  )}
                  <div className="flex items-center justify-between gap-2 pl-1">
                    <HealthStatusPill
                      tone={tone}
                      label={statusToLabel({ status: run.status })}
                    />
                    <span className="text-xs text-muted-foreground">
                      <RunTimestamp timestamp={run.timestamp} />
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-1">
                    <RunEnvironmentChip
                      environmentId={run.environmentId}
                      label={
                        run.environmentId
                          ? envNameById.get(run.environmentId)
                          : undefined
                      }
                    />
                    <RunSourceChip
                      sourceId={run.sourceId}
                      sourceLabel={run.sourceLabel}
                    />
                  </div>
                </div>
              );
            }
            case "retentionDivider": {
              return (
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-xs text-muted-foreground">
                    Aggregated before {format(item.cutoff, "PP")}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
              );
            }
            default: {
              const bucket = item.bucket;
              const tone = bucketTone(bucket);
              return (
                <div className="flex items-center gap-3 border-b border-border/40 px-3 py-2">
                  <Archive
                    className="h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-muted-foreground">
                      {format(new Date(bucket.bucketStart), "PP p")} –{" "}
                      {format(new Date(bucket.bucketEnd), "p")}
                    </span>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 text-xs font-medium tabular-nums",
                      toneStyles[tone].pill,
                      "rounded-full px-2 py-0.5",
                    )}
                  >
                    {Math.round(bucket.successRate)}% healthy · {bucket.runCount}{" "}
                    runs
                  </span>
                </div>
              );
            }
          }
        }}
      />
    </div>
  );
};
