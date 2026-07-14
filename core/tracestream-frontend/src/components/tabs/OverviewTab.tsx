import { usePluginClient } from "@checkstack/frontend-api";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  StatTile,
  StatusBadge,
  EmptyState,
  Skeleton,
  formatNumber,
  formatSpanDuration,
  formatRelativeTime,
} from "@checkstack/ui";
import { CircleAlert, Network, Waypoints } from "lucide-react";
import { TracestreamApi } from "@checkstack/tracestream-common";
import { ImportantEventsTimeline } from "../ImportantEventsTimeline";

export interface OverviewTabProps {
  streamId: string;
  /** Open a trace in the Traces tab. */
  onOpenTrace: (traceId: string) => void;
}

/**
 * Overview tab: headline stat tiles (24h traces / error traces / retained /
 * spans), the top services by span volume, the slowest retained traces (each a
 * quick link into the Traces tab) and the important-events feed. All reads come
 * from `getStreamOverview` + `listImportantEvents`; resource-scoped activity
 * signals auto-invalidate them.
 */
export function OverviewTab({ streamId, onOpenTrace }: OverviewTabProps) {
  const client = usePluginClient(TracestreamApi);

  const { data: overview, isLoading } = client.getStreamOverview.useQuery({
    streamId,
  });
  const { data: events } = client.listImportantEvents.useQuery({ streamId });

  const totals = overview?.totals24h;
  const topServices = overview?.topServices ?? [];
  const slowest = overview?.slowestRetained ?? [];
  const maxSpanCount = Math.max(1, ...topServices.map((s) => s.spanCount));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} variant="card" />
          ))
        ) : (
          <>
            <StatTile
              label="Traces (24h)"
              value={formatNumber(totals?.traces ?? 0)}
              footer={`${formatNumber(totals?.spans ?? 0)} spans`}
            />
            <StatTile
              label="Error traces (24h)"
              value={formatNumber(totals?.errorTraces ?? 0)}
              tone={(totals?.errorTraces ?? 0) > 0 ? "warn" : "default"}
            />
            <StatTile
              label="Retained (24h)"
              value={formatNumber(totals?.retainedTraces ?? 0)}
              hoverTitle="Traces whose raw spans were kept by the sampling policy."
            />
            <StatTile
              label="Last received"
              value={
                overview?.lastReceivedAt
                  ? formatRelativeTime(overview.lastReceivedAt)
                  : "never"
              }
              hoverTitle="Most recent span activity on this stream."
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top services</CardTitle>
            <CardDescription>By span volume in the last 24h.</CardDescription>
          </CardHeader>
          <CardContent>
            {topServices.length === 0 ? (
              <EmptyState
                icon={<Network className="h-6 w-6" />}
                title="No services yet"
                description="Services appear once spans arrive on this stream."
              />
            ) : (
              <ul className="space-y-2">
                {topServices.map((service) => (
                  <li key={service.serviceName} className="space-y-1">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate text-foreground">
                        {service.serviceName}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {formatNumber(service.spanCount)}
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-inset">
                      <div
                        className="h-full rounded-full bg-[hsl(var(--chart-1))]"
                        style={{
                          width: `${(service.spanCount / maxSpanCount) * 100}%`,
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Slowest retained traces</CardTitle>
            <CardDescription>
              Longest traces kept in the last 24h. Click to open the waterfall.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {slowest.length === 0 ? (
              <EmptyState
                icon={<Waypoints className="h-6 w-6" />}
                title="No retained traces yet"
                description="Retained traces show up here once sampling keeps some."
              />
            ) : (
              <ul className="divide-y divide-border">
                {slowest.map((trace) => (
                  <li key={trace.traceId}>
                    <button
                      type="button"
                      onClick={() => onOpenTrace(trace.traceId)}
                      className="flex w-full items-center justify-between gap-3 py-2 text-left hover:bg-surface-inset"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-foreground">
                          {trace.rootSpanName ?? "unknown"}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {trace.rootServiceName ?? "unknown service"} ·{" "}
                          {formatRelativeTime(trace.startTs)}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        {trace.hasError && (
                          <StatusBadge tone="error" icon={CircleAlert} label="Error" />
                        )}
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">
                          {formatSpanDuration(trace.durationMs)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Important events</CardTitle>
        </CardHeader>
        <CardContent>
          <ImportantEventsTimeline events={events?.events ?? []} />
        </CardContent>
      </Card>
    </div>
  );
}
