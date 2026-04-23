import React, { useState, useCallback } from "react";
import {
  usePluginClient,
  type SlotContext,
} from "@checkstack/frontend-api";
import { useSignal } from "@checkstack/signal-frontend";
import { SystemDetailsSlot } from "@checkstack/catalog-common";
import {
  HEALTH_CHECK_RUN_COMPLETED,
  HealthCheckApi,
} from "@checkstack/healthcheck-common";
import {
  HealthBadge,
  LoadingSpinner,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@checkstack/ui";
import { Heart } from "lucide-react";
import { HealthCheckSparkline } from "./HealthCheckSparkline";
import { HealthCheckDrawer } from "./HealthCheckDrawer";

import type {
  StateThresholds,
  HealthCheckStatus,
} from "@checkstack/healthcheck-common";

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
  intervalSeconds: number;
  lastRunAt?: Date;
  stateThresholds?: StateThresholds;
  recentStatusHistory: HealthCheckStatus[];
}

export function HealthCheckSystemOverview(props: SlotProps) {
  const systemId = props.system.id;
  const healthCheckClient = usePluginClient(HealthCheckApi);

  const [selectedCheck, setSelectedCheck] = useState<
    HealthCheckOverviewItem | undefined
  >();

  // Fetch health check overview using useQuery
  const {
    data: overviewData,
    isLoading: initialLoading,
    refetch,
  } = healthCheckClient.getSystemHealthOverview.useQuery({
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
      intervalSeconds: check.intervalSeconds,
      lastRunAt: check.recentRuns.at(-1)?.timestamp
        ? new Date(check.recentRuns.at(-1)!.timestamp)
        : undefined,
      stateThresholds: check.stateThresholds,
      recentStatusHistory: check.recentRuns.map((r) => r.status),
    }));
  }, [overviewData]);

  // Listen for realtime health check updates to refresh overview
  useSignal(
    HEALTH_CHECK_RUN_COMPLETED,
    useCallback(
      ({ systemId: changedId }) => {
        if (changedId === systemId) {
          void refetch();
        }
      },
      [systemId, refetch],
    ),
  );

  if (initialLoading) {
    return <LoadingSpinner />;
  }

  if (overview.length === 0) {
    return;
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Heart className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base font-semibold">
              Health Checks
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {overview.map((item) => (
              <button
                key={item.configurationId}
                className="w-full px-4 py-3 text-left hover:bg-muted/50 transition-colors flex items-center gap-3"
                onClick={() => setSelectedCheck(item)}
              >
                {/* Check name */}
                <span className="font-medium truncate flex-1 min-w-0 text-sm">
                  {item.name}
                </span>

                {/* Status badge */}
                <HealthBadge status={item.state} />

                {/* Sparkline */}
                {item.recentStatusHistory.length > 0 && (
                  <div className="hidden sm:block shrink-0">
                    <HealthCheckSparkline
                      runs={item.recentStatusHistory.map((status) => ({
                        status,
                      }))}
                    />
                  </div>
                )}

                {/* Last run — compact fixed-width to prevent shift */}
                <span className="hidden md:block text-xs text-muted-foreground w-10 text-right shrink-0 tabular-nums">
                  {formatCompactTime(item.lastRunAt)}
                </span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Slide-over Drawer */}
      {selectedCheck && (
        <HealthCheckDrawer
          item={selectedCheck}
          systemId={systemId}
          open={!!selectedCheck}
          onOpenChange={(open) => {
            if (!open) setSelectedCheck(undefined);
          }}
        />
      )}
    </>
  );
}
