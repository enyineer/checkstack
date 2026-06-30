import React, { useState, lazy, Suspense } from "react";
import { useSearchParams } from "react-router-dom";
import {
  usePluginClient,
  type SlotContext,
} from "@checkstack/frontend-api";
import { SystemDetailsSlot, CatalogApi } from "@checkstack/catalog-common";
import { HealthCheckApi } from "@checkstack/healthcheck-common";
import {
  LoadingSpinner,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  cn,
} from "@checkstack/ui";
import { Heart, Layers } from "lucide-react";
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
// Lazy-loaded: the drawer pulls in the recharts-based latency/timeline charts
// (~300 KB). This component is an eagerly-registered slot extension, so a static
// import would ship recharts in the initial bundle. The drawer only renders when
// a check is selected, so deferring it keeps charts out of the initial load.
const HealthCheckDrawer = lazy(() =>
  import("./HealthCheckDrawer").then((m) => ({ default: m.HealthCheckDrawer })),
);

import type {
  StateThresholds,
  HealthCheckStatus,
} from "@checkstack/healthcheck-common";

type HealthFilter = "all" | "failing" | "healthy";

const FILTERS: { value: HealthFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "failing", label: "Failing" },
  { value: "healthy", label: "Healthy" },
];

function parseFilter(raw: string | null): HealthFilter {
  return raw === "failing" || raw === "healthy" ? raw : "all";
}

function matchesFilter(
  state: HealthCheckStatus,
  filter: HealthFilter,
  paused: boolean,
) {
  // A paused check is neither actively failing nor actively healthy — it's
  // dormant. Only show it under "all"; the "failing"/"healthy" tabs hide it
  // so a paused check can't masquerade as a current failure (its stale runs
  // may still evaluate to unhealthy even though it's not running).
  if (paused) return filter === "all";
  if (filter === "all") return true;
  if (filter === "healthy") return state === "healthy";
  return state !== "healthy";
}

type SlotProps = SlotContext<typeof SystemDetailsSlot>;

/**
 * Compact relative time formatter that prevents layout shift.
 * Returns fixed-width strings like "< 1m", "5m", "2h", "3d".
 */
function formatCompactTime(date: Date | undefined): string {
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

interface HealthCheckOverviewItem {
  configurationId: string;
  strategyId: string;
  name: string;
  state: HealthCheckStatus;
  paused: boolean;
  intervalSeconds: number;
  lastRunAt?: Date;
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
   * Stable per-row key: the check id for env-less / single-env rows, or
   * `${configurationId}::${environmentId}` for a per-(check, env) row.
   */
  rowKey: string;
}

export function HealthCheckSystemOverview(props: SlotProps) {
  const systemId = props.system.id;
  const healthCheckClient = usePluginClient(HealthCheckApi);
  const catalogClient = usePluginClient(CatalogApi);
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = parseFilter(searchParams.get("filter"));

  const [selectedCheck, setSelectedCheck] = useState<
    HealthCheckOverviewItem | undefined
  >();

  // Fetch health check overview using useQuery — kept fresh via SignalAutoInvalidator.
  const { data: overviewData, isLoading: initialLoading } =
    healthCheckClient.getSystemHealthOverview.useQuery({
      systemId,
    });

  // Resolve env names for env-qualified rows. Same query the drawer already
  // issues, so the resulting cache entry is shared when both surfaces mount.
  // Disabled when there is no systemId (can't happen here, but defensively
  // typed so React Query doesn't fetch in a unit test).
  const { data: systemEnvironments = [] } =
    catalogClient.getSystemEnvironments.useQuery(
      { systemId },
      { enabled: !!systemId },
    );
  const envNameById = React.useMemo(
    () => new Map(systemEnvironments.map((e) => [e.id, e.name])),
    [systemEnvironments],
  );

  // Transform API response to component format. Flatten into one row per
  // (check, environment) when an assignment fans out to multiple envs —
  // surfacing per-env outages the rollup intentionally hides in the aggregate
  // view. Single-env / env-less assignments stay one row (the pre-flattening
  // shape). Each row opens the same check-level drawer; the env context is
  // just a label so the operator sees which environment this row's status
  // is scoped to.
  const overview: HealthCheckOverviewItem[] = React.useMemo(() => {
    if (!overviewData) return [];
    const rows: HealthCheckOverviewItem[] = [];
    for (const check of overviewData.checks) {
      const stateThresholds = check.stateThresholds;
      const checkLastRunAt = check.recentRuns.at(-1)?.timestamp
        ? new Date(check.recentRuns.at(-1)!.timestamp)
        : undefined;
      const checkRecentStatusHistory = check.recentRuns.map((r) => r.status);

      const perEnv = check.perEnvironment;
      if (!perEnv || perEnv.length <= 1) {
        // Single-env / env-less: keep the historical single-row shape. The
        // row is the rollup for this check (worst-wins across envs, which
        // equals the per-env status when there's only one env).
        rows.push({
          rowKey: check.configurationId,
          configurationId: check.configurationId,
          strategyId: check.strategyId,
          name: check.configurationName,
          state: check.status,
          paused: check.paused,
          intervalSeconds: check.intervalSeconds,
          lastRunAt: checkLastRunAt,
          stateThresholds,
          recentStatusHistory: checkRecentStatusHistory,
        });
        continue;
      }
      // Multi-env: one row per environment. Each row carries the env id +
      // the resolved env name (rendered as a pill next to the check name),
      // the per-env status, the per-env sparkline, and the per-env last
      // run. `state` here is the per-env rollup, so the failing/healthy
      // filter applies per env — one failing env shows up under "failing"
      // while its healthy sibling doesn't. Clicking any env row opens the
      // drawer for the whole check (the drawer still aggregates envs in
      // its history table; this UI is the disambiguation surface).
      for (const pe of perEnv) {
        const environmentId = pe.environmentId;
        const envName =
          environmentId === null
            ? undefined
            : (envNameById.get(environmentId) ?? environmentId);
        rows.push({
          rowKey: `${check.configurationId}::${environmentId ?? "<none>"}`,
          configurationId: check.configurationId,
          strategyId: check.strategyId,
          name: check.configurationName,
          state: pe.status,
          paused: check.paused,
          intervalSeconds: check.intervalSeconds,
          lastRunAt: pe.recentRuns.at(-1)?.timestamp
            ? new Date(pe.recentRuns.at(-1)!.timestamp)
            : undefined,
          stateThresholds,
          recentStatusHistory: pe.recentRuns.map((r) => r.status),
          environmentId,
          environmentName: envName,
        });
      }
    }
    return rows;
  }, [overviewData, envNameById]);

  const visible = React.useMemo(
    () =>
      overview.filter((item) =>
        matchesFilter(item.state, filter, item.paused),
      ),
    [overview, filter],
  );

  const setFilter = (next: HealthFilter) => {
    const params = new URLSearchParams(searchParams);
    if (next === "all") {
      params.delete("filter");
    } else {
      params.set("filter", next);
    }
    setSearchParams(params, { replace: true });
  };

  if (initialLoading) {
    return <LoadingSpinner />;
  }

  if (overview.length === 0) {
    return;
  }

  return (
    <>
      <div className="overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Heart className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base font-semibold">
                Health Checks
              </CardTitle>
            </div>
            <div
              className="flex items-center gap-1 rounded-md border bg-surface-inset p-0.5"
              role="tablist"
              aria-label="Filter health checks"
            >
              {FILTERS.map((f) => {
                const active = filter === f.value;
                return (
                  <Button
                    key={f.value}
                    size="sm"
                    variant={active ? "secondary" : "ghost"}
                    className="h-7 px-2 text-xs"
                    onClick={() => setFilter(f.value)}
                    role="tab"
                    aria-selected={active}
                  >
                    {f.label}
                  </Button>
                );
              })}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {visible.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">
              No health checks match the{" "}
              <span className="font-medium">{filter}</span> filter.
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {visible.map((item) => {
                const tone = statusToTone({ status: item.state });
                const historyLength = item.recentStatusHistory.length;
                const healthyCount = countHealthy({
                  history: item.recentStatusHistory,
                });
                // A paused check is dormant — render a "Paused" pill (unknown
                // tone) instead of the run-evaluated status, since its stale
                // runs are not a meaningful current verdict. The accent stripe
                // and the healthy/total figure + sparkline still reflect the
                // pre-pause history for context.
                const displayTone = item.paused
                  ? (pausedToTone({ paused: true }) as StatusTone)
                  : tone;
                const displayLabel = item.paused
                  ? "Paused"
                  : statusToLabel({ status: item.state });
                // An env-scoped row carries the env name as a pill next to
                // the check name. `null` is the env-less slice; `undefined`
                // is the single-row rollup (no pill).
                const envScoped =
                  item.environmentId !== undefined && item.environmentId !== null;
                const envLabel =
                  item.environmentId === null
                    ? "No environment"
                    : (item.environmentName ?? item.environmentId ?? "");
                return (
                  <button
                    key={item.rowKey}
                    className="group relative flex w-full items-center gap-3 py-3 pl-5 pr-4 text-left transition-colors hover:bg-surface-inset"
                    onClick={() => setSelectedCheck(item)}
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
                        {envScoped && (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border/60 bg-surface-inset px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            <Layers className="h-2.5 w-2.5" />
                            {envLabel}
                          </span>
                        )}
                      </div>
                      <HealthStatusPill
                        tone={displayTone}
                        label={displayLabel}
                        className="self-start"
                      />
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
              })}
            </div>
          )}
        </CardContent>
      </div>

      {/* Slide-over Drawer (lazy: loads the chart bundle on first open) */}
      {selectedCheck && (
        <Suspense fallback={null}>
          <HealthCheckDrawer
            item={selectedCheck}
            systemId={systemId}
            open={!!selectedCheck}
            onOpenChange={(open) => {
              if (!open) setSelectedCheck(undefined);
            }}
          />
        </Suspense>
      )}
    </>
  );
}
