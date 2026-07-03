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
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@checkstack/ui";
import { Heart, Archive } from "lucide-react";
import {
  HealthCheckOverviewRow,
  type HealthCheckOverviewItem,
} from "./HealthCheckOverviewRow";
import { buildOverviewRows } from "./overviewRows.logic";
// Lazy-loaded: the drawer pulls in the full chart stack (timeline, latency,
// auto-chart tiles). This component is an eagerly-registered slot extension,
// so a static import would ship all of that in the initial bundle. The drawer
// only renders when a check is selected, so deferring it keeps the charts out
// of the initial load.
const HealthCheckDrawer = lazy(() =>
  import("./HealthCheckDrawer").then((m) => ({ default: m.HealthCheckDrawer })),
);

import type { HealthCheckStatus } from "@checkstack/healthcheck-common";

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

  // Environments CURRENTLY ASSIGNED to this system — the source of truth for
  // which env slices are still live (orphan detection). Same query the drawer
  // issues, so the cache entry is shared when both surfaces mount. Disabled
  // when there is no systemId (can't happen here, but defensively typed so
  // React Query doesn't fetch in a unit test).
  const { data: assignedEnvironments = [], isLoading: assignedEnvsLoading } =
    catalogClient.getSystemEnvironments.useQuery(
      { systemId },
      { enabled: !!systemId },
    );
  // ALL environments in the instance — used only to resolve display names, so a
  // check for an environment that was UNASSIGNED (but still exists) shows the
  // environment's name instead of its raw id. A truly DELETED environment isn't
  // here and falls back to a "Removed environment" label in the row.
  const { data: allEnvironments = [], isLoading: allEnvsLoading } =
    catalogClient.listEnvironments.useQuery();
  const envNameById = React.useMemo(
    () => new Map(allEnvironments.map((e) => [e.id, e.name])),
    [allEnvironments],
  );

  // Transform API response to component format. Flatten into one row per
  // (check, environment), tagging leftover env slices as orphaned so they can
  // be grouped under "Old checks". See buildOverviewRows for the rules.
  const overview = React.useMemo(
    () =>
      overviewData
        ? buildOverviewRows({
            checks: overviewData.checks,
            environmentIds: assignedEnvironments.map((e) => e.id),
            envNameById,
          })
        : [],
    [overviewData, envNameById, assignedEnvironments],
  );

  const visible = React.useMemo(
    () =>
      overview.filter((item) =>
        matchesFilter(item.state, filter, item.paused),
      ),
    [overview, filter],
  );

  // Partition into live checks and the "Old checks" group. Both respect the
  // active health filter so a stale slice can't slip past it.
  const currentRows = React.useMemo(
    () => visible.filter((r) => !r.isOrphaned),
    [visible],
  );
  const oldRows = React.useMemo(
    () => visible.filter((r) => r.isOrphaned),
    [visible],
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

  // Wait for the environment data too: assigned envs decide orphan grouping and
  // the full list decides display names, so rendering before they resolve would
  // flash live checks into "Old checks" or mislabel envs as "Removed".
  if (initialLoading || assignedEnvsLoading || allEnvsLoading) {
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
          {currentRows.length === 0 && oldRows.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">
              No health checks match the{" "}
              <span className="font-medium">{filter}</span> filter.
            </div>
          ) : (
            <>
              {currentRows.length > 0 ? (
                <div className="divide-y divide-border/60">
                  {currentRows.map((item) => (
                    <HealthCheckOverviewRow
                      key={item.rowKey}
                      item={item}
                      onSelect={setSelectedCheck}
                    />
                  ))}
                </div>
              ) : (
                <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                  No current health checks match the{" "}
                  <span className="font-medium">{filter}</span> filter.
                </div>
              )}

              {/* Orphaned slices (removed environments, or env-less leftovers of
                  a now-fanned-out check) are tucked into a collapsed group so
                  they keep their history without cluttering the live list. */}
              {oldRows.length > 0 && (
                <Accordion type="single" collapsible>
                  <AccordionItem
                    value="old-checks"
                    className="border-b-0 border-t border-border/60"
                  >
                    <AccordionTrigger className="px-5 py-3 text-xs font-medium text-muted-foreground hover:no-underline">
                      <span className="flex items-center gap-2">
                        <Archive className="h-3.5 w-3.5" />
                        Old checks
                        <span className="rounded-full bg-surface-inset px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                          {oldRows.length}
                        </span>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="p-0">
                      <p className="px-5 pb-3 text-xs text-muted-foreground">
                        These checks ran for environments that were removed, or
                        before this system used environments. Their history is
                        kept, but they no longer receive updates.
                      </p>
                      <div className="divide-y divide-border/60 border-t border-border/60">
                        {oldRows.map((item) => (
                          <HealthCheckOverviewRow
                            key={item.rowKey}
                            item={item}
                            onSelect={setSelectedCheck}
                          />
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              )}
            </>
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
