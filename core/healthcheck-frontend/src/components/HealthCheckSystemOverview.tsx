import React, { useState, lazy, Suspense } from "react";
import { useSearchParams } from "react-router-dom";
import {
  usePluginClient,
  type SlotContext,
} from "@checkstack/frontend-api";
import { SystemDetailsSlot } from "@checkstack/catalog-common";
import { HealthCheckApi } from "@checkstack/healthcheck-common";
import {
  LoadingSpinner,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  cn,
} from "@checkstack/ui";
import { Heart } from "lucide-react";
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
}

export function HealthCheckSystemOverview(props: SlotProps) {
  const systemId = props.system.id;
  const healthCheckClient = usePluginClient(HealthCheckApi);
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

  // Transform API response to component format
  const overview: HealthCheckOverviewItem[] = React.useMemo(() => {
    if (!overviewData) return [];
    return overviewData.checks.map((check) => ({
      configurationId: check.configurationId,
      strategyId: check.strategyId,
      name: check.configurationName,
      state: check.status,
      paused: check.paused,
      intervalSeconds: check.intervalSeconds,
      lastRunAt: check.recentRuns.at(-1)?.timestamp
        ? new Date(check.recentRuns.at(-1)!.timestamp)
        : undefined,
      stateThresholds: check.stateThresholds,
      recentStatusHistory: check.recentRuns.map((r) => r.status),
    }));
  }, [overviewData]);

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
                return (
                  <button
                    key={item.configurationId}
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

                    {/* Status pill + check name */}
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <span className="truncate text-sm font-medium text-foreground">
                        {item.name}
                      </span>
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
