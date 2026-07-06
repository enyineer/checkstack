import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  usePluginClient,
  useApi,
  accessApiRef,
  type SlotContext,
} from "@checkstack/frontend-api";
import { resolveRoute } from "@checkstack/common";
import {
  SystemDetailsSlot,
  CatalogApi,
  catalogAccess,
  catalogResourceTypes,
  catalogRoutes,
} from "@checkstack/catalog-common";
import { HealthCheckApi } from "@checkstack/healthcheck-common";
import {
  DependencyApi,
  dependencyAccess,
  type Dependency,
} from "@checkstack/dependency-common";
import { cn, LoadingSpinner } from "@checkstack/ui";
import { ArrowUpRight, ArrowDownLeft, Network } from "lucide-react";

const PANEL_SHADOW =
  "shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]";

type Props = SlotContext<typeof SystemDetailsSlot>;

/** One neighbour system in a given direction, with the edge that links it. */
interface NeighbourRow {
  systemId: string;
  dependency: Dependency;
}

/** Health dot colour by the neighbour's own health status. */
function healthDotClass(status: string | undefined): string {
  switch (status) {
    case "unhealthy": {
      return "bg-status-down";
    }
    case "degraded": {
      return "bg-status-warn";
    }
    case "healthy": {
      return "bg-status-ok";
    }
    default: {
      return "bg-muted-foreground/40";
    }
  }
}

/** Compact impact chip mirroring the edge editor's severity vocabulary. */
function ImpactChip({ impactType }: { impactType: string }): React.ReactNode {
  if (impactType === "critical") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-status-down/10 px-2 py-0.5 text-[11px] font-medium text-status-down">
        <span className="size-1.5 rounded-full bg-status-down" />
        Critical
      </span>
    );
  }
  if (impactType === "degraded") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-status-warn/10 px-2 py-0.5 text-[11px] font-medium text-status-warn">
        <span className="size-1.5 rounded-full bg-status-warn" />
        Degraded
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      <span className="size-1.5 rounded-full bg-muted-foreground/60" />
      Info
    </span>
  );
}

/** Short scope summary for a dependency's scope cells. */
function scopeSummary(dependency: Dependency): string {
  const cells = dependency.healthCheckRules ?? [];
  if (cells.length === 0) return "Any check, any env";
  return cells.length === 1 ? "1 scope" : `${cells.length} scopes`;
}

/** A single neighbour row: health dot, linked name, scope, impact chip. */
function DependencyRow({
  row,
  name,
  healthStatus,
}: {
  row: NeighbourRow;
  name: string;
  healthStatus: string | undefined;
}): React.ReactNode {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-surface-inset">
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={cn("size-2 shrink-0 rounded-full", healthDotClass(healthStatus))}
          aria-hidden
        />
        <Link
          to={resolveRoute(catalogRoutes.routes.systemDetail, {
            systemId: row.systemId,
          })}
          className="truncate text-sm font-medium text-foreground hover:underline"
        >
          {name}
        </Link>
        <span className="hidden truncate text-xs text-muted-foreground sm:inline">
          {scopeSummary(row.dependency)}
        </span>
      </div>
      <ImpactChip impactType={row.dependency.impactType} />
    </div>
  );
}

/**
 * Read-only up/downstream dependency panel for a system's detail page.
 *
 * Visible to anyone allowed to read this system's dependencies: holders of the
 * global dependency-map rule OR users who can MANAGE this system (a team grant
 * on the `catalog.system`), mirroring how map edge editing is gated. Lists what
 * the system depends on (upstream) and what depends on it (downstream), each
 * neighbour linking to its own detail page with a live health dot.
 */
export const SystemDependenciesPanel: React.FC<Props> = ({ system }) => {
  const systemId = system?.id ?? "";
  const accessApi = useApi(accessApiRef);
  const depClient = usePluginClient(DependencyApi);
  const catalogClient = usePluginClient(CatalogApi);
  const healthClient = usePluginClient(HealthCheckApi);

  // Gate: global map read OR team manage-on-this-system.
  const { allowed: hasMapAccess } = accessApi.useAccess(dependencyAccess.map);
  const { canAccess: canManageSystem } = accessApi.useResourceAccess({
    accessRule: catalogAccess.system.manage,
    objectType: catalogResourceTypes.system,
    resourceIds: systemId ? [systemId] : [],
  });
  const allowed = Boolean(systemId) && (hasMapAccess || canManageSystem(systemId));

  const { data: depsData, isLoading } = depClient.getDependencies.useQuery(
    { systemId, direction: "both" },
    { enabled: allowed && Boolean(systemId) },
  );

  const { data: systemsData } = catalogClient.getSystems.useQuery(
    {},
    { enabled: allowed },
  );

  const nameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of systemsData?.systems ?? []) map.set(s.id, s.name);
    return map;
  }, [systemsData]);

  // Split the both-directions edge list into upstream and downstream neighbours.
  const { upstream, downstream, neighbourIds } = useMemo(() => {
    const up: NeighbourRow[] = [];
    const down: NeighbourRow[] = [];
    for (const dep of depsData?.dependencies ?? []) {
      if (dep.sourceSystemId === systemId) {
        up.push({ systemId: dep.targetSystemId, dependency: dep });
      } else if (dep.targetSystemId === systemId) {
        down.push({ systemId: dep.sourceSystemId, dependency: dep });
      }
    }
    const ids = [...new Set([...up, ...down].map((r) => r.systemId))];
    return { upstream: up, downstream: down, neighbourIds: ids };
  }, [depsData, systemId]);

  const { data: healthData } = healthClient.getBulkSystemHealthStatus.useQuery(
    { systemIds: neighbourIds },
    { enabled: allowed && neighbourIds.length > 0 },
  );
  const healthStatuses = healthData?.statuses ?? {};

  if (!allowed) return null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center rounded-[var(--d-card-r)] border border-border/70 bg-surface px-3 py-2">
        <LoadingSpinner />
      </div>
    );
  }

  const hasAny = upstream.length > 0 || downstream.length > 0;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface p-[var(--d-pad)]",
        PANEL_SHADOW,
      )}
    >
      <div className="flex items-center gap-2">
        <Network className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-semibold text-foreground">Dependencies</p>
      </div>

      {!hasAny && (
        <p className="mt-2 text-sm text-muted-foreground">
          This system has no recorded dependencies.
        </p>
      )}

      {upstream.length > 0 && (
        <div className="mt-3">
          <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <ArrowUpRight className="h-3.5 w-3.5" />
            Depends on
          </div>
          <div className="mt-1 divide-y divide-border/50">
            {upstream.map((row) => (
              <DependencyRow
                key={row.dependency.id}
                row={row}
                name={nameMap.get(row.systemId) ?? row.systemId.slice(0, 8)}
                healthStatus={healthStatuses[row.systemId]?.status}
              />
            ))}
          </div>
        </div>
      )}

      {downstream.length > 0 && (
        <div className="mt-3">
          <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <ArrowDownLeft className="h-3.5 w-3.5" />
            Depended on by
          </div>
          <div className="mt-1 divide-y divide-border/50">
            {downstream.map((row) => (
              <DependencyRow
                key={row.dependency.id}
                row={row}
                name={nameMap.get(row.systemId) ?? row.systemId.slice(0, 8)}
                healthStatus={healthStatuses[row.systemId]?.status}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
