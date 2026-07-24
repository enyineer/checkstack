import React from "react";
import { cn } from "@checkstack/ui";
import { EnvironmentPill, SourcePill } from "./EnvironmentPill";
import { HealthCheckSparkline } from "./HealthCheckSparkline";
import { HealthStatusPill } from "./HealthStatusPill";
import {
  countHealthy,
  pausedToTone,
  statusToLabel,
  statusToTone,
  toneStyles,
  type StatusTone,
} from "./healthcheckDisplay.logic";
import type {
  StateThresholds,
  HealthCheckStatus,
} from "@checkstack/healthcheck-common";

export interface HealthCheckOverviewItem {
  configurationId: string;
  strategyId: string;
  name: string;
  state: HealthCheckStatus;
  paused: boolean;
  intervalSeconds: number;
  lastRunAt?: Date;
  /**
   * Timestamp of the most recent HEALTHY run for this row (check, or check+env
   * when fanned out). Computed on the backend outside the sparkline window, so
   * it stays accurate for long-failing checks. Absent when the row has never
   * had a successful run. Surfaced (for non-healthy rows) so operators can see
   * at a glance since when the slice has been degraded/unhealthy.
   */
  lastSuccessfulRunAt?: Date;
  stateThresholds?: StateThresholds;
  recentStatusHistory: HealthCheckStatus[];
  /**
   * The environment this row is scoped to. `null` for an env-less run; a
   * concrete string for a per-env row. `undefined` (absent) for the
   * rollup-only shape the overview used prior to per-env flattening —
   * signals the row is not env-scoped and should render without an env
   * pill.
   */
  environmentId?: string | null;
  /**
   * Human-readable env name for an env-scoped row. The overview fetches the
   * system's `getSystemEnvironments` and resolves the env id → name here so
   * each row carries a stable operator-facing label.
   */
  environmentName?: string;
  /**
   * Human-readable name of the LOCATION this slice was probed from (the local
   * core, or a satellite). Set only when naming it carries information - a
   * check that only ever runs on the core leaves it undefined. See
   * `resolveSliceSourceLabel`.
   */
  sourceLabel?: string;
  /**
   * Stable per-row key: the check id for a single-slice row, or
   * `${configurationId}::${environmentId}::${sourceId}` for a per-slice row.
   */
  rowKey: string;
  /**
   * True when this row is a leftover env slice that no longer receives runs:
   * either the env-less slice of a check that now fans out to environments, or
   * a slice for an environment that has been removed from the system. Its
   * history is preserved but the overview groups it under "Old checks" so it
   * doesn't masquerade as a live check.
   */
  isOrphaned: boolean;
}

/**
 * Compact relative time formatter that prevents layout shift.
 * Returns fixed-width strings like "< 1m", "5m", "2h", "3d".
 */
export function formatCompactTime(date: Date | undefined): string {
  if (!date) return "—";
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "< 1m";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/**
 * Compact "since when has this been failing" label derived from the last
 * successful run. `undefined` timestamp means the row has never succeeded.
 */
export function formatLastHealthy(date: Date | undefined): string {
  if (!date) return "Never healthy";
  return `Healthy until ${formatCompactTime(date)} ago`;
}

/**
 * A single health-check row in the system overview: status pill, name (with an
 * env pill when the row is env-scoped), the recent-history hero figure,
 * sparkline, and a compact last-run stamp. Shared between the live list and the
 * collapsed "Old checks" group so both render identically.
 */
export const HealthCheckOverviewRow: React.FC<{
  item: HealthCheckOverviewItem;
  onSelect: (item: HealthCheckOverviewItem) => void;
}> = ({ item, onSelect }) => {
  const tone = statusToTone({ status: item.state });
  const historyLength = item.recentStatusHistory.length;
  const healthyCount = countHealthy({ history: item.recentStatusHistory });
  // A paused check is dormant — render a "Paused" pill (unknown tone) instead
  // of the run-evaluated status, since its stale runs are not a meaningful
  // current verdict. The accent stripe and the healthy/total figure +
  // sparkline still reflect the pre-pause history for context.
  const displayTone = item.paused
    ? (pausedToTone({ paused: true }) as StatusTone)
    : tone;
  const displayLabel = item.paused
    ? "Paused"
    : statusToLabel({ status: item.state });
  // An env-scoped row carries the env name as a pill next to the check name.
  // `null` is the env-less slice; `undefined` is the single-row rollup (no
  // pill). A non-null env with no resolved name has been deleted from the
  // catalog, so it reads as "Removed environment" rather than a raw id.
  const envScoped =
    item.environmentId !== undefined && item.environmentId !== null;
  const envLabel =
    item.environmentId === null
      ? "No environment"
      : (item.environmentName ?? "Removed environment");
  return (
    <button
      className="group relative flex w-full items-center gap-3 py-3 pl-5 pr-4 text-left transition-colors hover:bg-surface-inset"
      onClick={() => onSelect(item)}
    >
      {/* Status accent stripe: status by position + hue. */}
      <span
        className={cn(
          "absolute inset-y-0 left-0 w-1",
          toneStyles[displayTone].accent,
        )}
        aria-hidden
      />

      {/* Status pill + check name (with env pill when scoped) */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="truncate text-sm font-medium text-foreground">
            {item.name}
          </span>
          {envScoped && <EnvironmentPill label={envLabel} />}
          {item.sourceLabel && <SourcePill label={item.sourceLabel} />}
        </div>
        <HealthStatusPill
          tone={displayTone}
          label={displayLabel}
          className="self-start"
        />
        {/* Since-when indicator: for a live, currently-unhealthy/degraded row,
            surface when it was last healthy so operators see how long it has
            been failing without opening the drawer. Hidden for healthy/paused
            rows (nothing to explain) and for orphaned slices (no longer live). */}
        {!item.paused && !item.isOrphaned && item.state !== "healthy" && (
          <span
            className="text-[11px] leading-none text-muted-foreground"
            title={
              item.lastSuccessfulRunAt
                ? `Last healthy run: ${item.lastSuccessfulRunAt.toLocaleString()}`
                : "No successful run recorded yet"
            }
          >
            {formatLastHealthy(item.lastSuccessfulRunAt)}
          </span>
        )}
      </div>

      {/* Recent-history hero figure */}
      {historyLength > 0 && (
        <div className="hidden shrink-0 text-right sm:block">
          <span className="text-lg font-semibold leading-none tabular-nums text-foreground">
            {healthyCount}/{historyLength}
          </span>
          <span className="mt-0.5 block text-[10px] uppercase tracking-wide text-muted-foreground">
            healthy
          </span>
        </div>
      )}

      {/* Sparkline */}
      {historyLength > 0 && (
        <div className="hidden shrink-0 md:block">
          <HealthCheckSparkline
            runs={item.recentStatusHistory.map((status) => ({
              status,
            }))}
          />
        </div>
      )}

      {/* Last run — compact fixed-width to prevent shift */}
      <span className="hidden w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground md:block">
        {formatCompactTime(item.lastRunAt)}
      </span>
    </button>
  );
};
