import React, { useMemo } from "react";
import { Link } from "react-router";
import { usePluginClient } from "@checkstack/frontend-api";
import { resolveRoute } from "@checkstack/common";
import {
  MaintenanceApi,
  maintenanceRoutes,
  type MaintenanceWithSystems,
} from "@checkstack/maintenance-common";
import { CatalogApi } from "@checkstack/catalog-common";
import { cn, SectionHeader, usePerformance } from "@checkstack/ui";
import { formatDistanceToNow } from "date-fns";
import { Wrench, ArrowRight } from "lucide-react";
import { MaintenanceScheduleHero } from "./MaintenanceScheduleHero";
import {
  getMaintenanceStatusBadge,
  getMaintenanceStatusTone,
  getMaintenanceToneAccentClass,
} from "../utils/badges";
import { summarizeSystemNames } from "../pages/maintenanceConfig.logic";
import { selectUpcomingMaintenances } from "./dashboardUpcoming.logic";

const PANEL_SHADOW =
  "shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]";

/**
 * Dashboard section that surfaces scheduled (not-yet-started) maintenance
 * windows.
 *
 * The dashboard's philosophy is "only what needs attention right now", so a
 * scheduled window is not a per-system signal (it isn't broken yet). But
 * operators still need to see that planned work is coming, so this section
 * lists the soonest scheduled windows with a deep link into each maintenance's
 * detail page. Renders nothing when there is nothing upcoming - the dashboard
 * stays calm.
 *
 * Only `scheduled` windows are listed here. In-progress windows are already
 * surfaced as per-system signals by {@link MaintenanceSignalsFiller}; showing
 * them here too would duplicate.
 */
export const DashboardUpcomingMaintenances: React.FC = () => {
  const { isLowPower } = usePerformance();
  const maintenanceClient = usePluginClient(MaintenanceApi);
  const catalogClient = usePluginClient(CatalogApi);

  // Default list excludes completed; we further filter to `scheduled` only.
  // Kept fresh via SignalAutoInvalidator on `[["maintenance"]]`.
  const { data: maintenancesData, isLoading } =
    maintenanceClient.listMaintenances.useQuery(
      { includeCompleted: false },
      { refetchOnMount: "always", staleTime: 30_000 },
    );
  const { data: entitiesData } = catalogClient.getEntities.useQuery(
    {},
    { staleTime: 30_000 },
  );

  const systems = useMemo(
    () => entitiesData?.systems ?? [],
    [entitiesData],
  );

  const upcoming = useMemo(() => {
    const all = maintenancesData?.maintenances ?? [];
    return selectUpcomingMaintenances({
      maintenances: all,
      now: new Date(),
    });
  }, [maintenancesData]);

  // Stay out of the way while loading or when there is nothing to announce -
  // no skeleton, no empty state. The dashboard's own empty state covers the
  // "nothing in the install" story.
  if (isLoading || upcoming.length === 0) return null;

  return (
    <section
      className={cn(!isLowPower && "animate-in fade-in duration-300")}
      aria-label="Planned maintenances"
    >
      <SectionHeader
        title="Planned maintenances"
        icon={<Wrench className="h-5 w-5" />}
      />
      <div className="space-y-2">
        {upcoming.map((maintenance) => (
          <UpcomingMaintenanceRow
            key={maintenance.id}
            maintenance={maintenance}
            systems={systems}
          />
        ))}
      </div>
    </section>
  );
};

/**
 * One compact, expandable-free row: a left accent stripe in the status tone, a
 * leading schedule hero (duration + start), the title, the status pill, a
 * relative-time hint ("in 3 days"), and the affected systems. The whole row
 * links to the maintenance detail page.
 */
const UpcomingMaintenanceRow: React.FC<{
  maintenance: MaintenanceWithSystems;
  systems: { id: string; name: string }[];
}> = ({ maintenance, systems }) => {
  const { isLowPower } = usePerformance();
  const tone = getMaintenanceStatusTone(maintenance.status);
  const accent = getMaintenanceToneAccentClass(tone);
  const start = new Date(maintenance.startAt);

  // Relative hint for when the window starts ("in 3 days"). Falls back to an
  // absolute start time when the distance is too small to be useful.
  const hint = `starts ${formatDistanceToNow(start, { addSuffix: true })}`;

  return (
    <Link
      to={resolveRoute(maintenanceRoutes.routes.detail, {
        maintenanceId: maintenance.id,
      })}
      className={cn(
        "group relative block overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface p-[var(--d-pad)] pl-5",
        PANEL_SHADOW,
        !isLowPower &&
          "transition-all group-hover:-translate-y-0.5 group-hover:border-primary/40 group-hover:shadow-xl",
      )}
    >
      <span
        className={cn("absolute inset-y-0 left-0 w-1", accent)}
        aria-hidden
      />
      <div className="flex items-center gap-4">
        <MaintenanceScheduleHero
          startAt={maintenance.startAt}
          endAt={maintenance.endAt}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-foreground">
              {maintenance.title}
            </p>
            {getMaintenanceStatusBadge(maintenance.status)}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {summarizeSystemNames({
              systemIds: maintenance.systemIds,
              systems,
            })}
            {" · "}
            {hint}
          </p>
        </div>
        <ArrowRight
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground",
            !isLowPower && "transition-transform group-hover:translate-x-0.5",
          )}
          aria-hidden
        />
      </div>
    </Link>
  );
};
