import React, { useEffect, useMemo } from "react";
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
  type ImpactType,
} from "@checkstack/dependency-common";
import {
  cn,
  CollapsibleDetailCard,
  DetailCard,
  LoadingSpinner,
  Tooltip,
} from "@checkstack/ui";
import { ArrowUpRight, ArrowDownLeft, Info, Network, Zap } from "lucide-react";
import {
  presentDependencyImpact,
  type DependencyDirection,
  type ImpactTone,
} from "../utils/impact.logic";

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

/**
 * Per-tone chip classes. Deliberately NEUTRAL - impact is a static edge
 * attribute, not a live status, so it never uses the status (red/amber) palette
 * that would read as "impacted right now". Severity is ranked by emphasis
 * (foreground vs muted) and by the label, while the row's health dot remains the
 * only colour-coded live signal.
 */
const impactToneClass: Record<ImpactTone, string> = {
  critical: "border-border bg-surface-inset text-foreground",
  degraded: "border-border/70 bg-surface-inset text-muted-foreground",
  informational: "border-border/60 bg-surface-inset text-muted-foreground",
};

/**
 * Impact chip for a dependency edge. Describes what the edge DOES to the system
 * ("Critical impact") rather than a live status: a neutral chip (no status
 * colour) with an impact icon (not a status dot) and a direction-aware tooltip
 * spelling out the exact consequence, so it can't be misread as the neighbour
 * being down right now.
 */
function ImpactChip({
  impactType,
  direction,
  systemName,
  neighbourName,
}: {
  impactType: ImpactType;
  direction: DependencyDirection;
  systemName: string;
  neighbourName: string;
}): React.ReactNode {
  const { label, description, tone } = presentDependencyImpact({
    impactType,
    direction,
    systemName,
    neighbourName,
  });
  const Icon = tone === "informational" ? Info : Zap;
  return (
    <Tooltip content={description}>
      <span
        tabIndex={0}
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
          impactToneClass[tone],
        )}
      >
        <Icon className="size-3" aria-hidden />
        {label}
      </span>
    </Tooltip>
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
  systemName,
  direction,
  healthStatus,
}: {
  row: NeighbourRow;
  name: string;
  systemName: string;
  direction: DependencyDirection;
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
      <ImpactChip
        impactType={row.dependency.impactType}
        direction={direction}
        systemName={systemName}
        neighbourName={name}
      />
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
export const SystemDependenciesPanel: React.FC<Props> = ({
  system,
  onLoadingChange,
}) => {
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

  // Report load state so the detail page reveals all overview cards together
  // instead of each popping in as its own fetch settles.
  useEffect(() => {
    onLoadingChange?.("dependency.panel", isLoading);
  }, [isLoading, onLoadingChange]);

  if (!allowed) return null;

  if (isLoading) {
    return (
      <DetailCard surface="flat" className="flex items-center justify-center px-3 py-2">
        <LoadingSpinner />
      </DetailCard>
    );
  }

  const hasAny = upstream.length > 0 || downstream.length > 0;
  const total = upstream.length + downstream.length;

  // Collapsed by default: the card shows just its header + a count, and the
  // up/downstream lists expand on demand so the overview column stays compact.
  // The shared CollapsibleDetailCard owns the header/toggle/chevron so this card
  // stays visually identical to the other collapsible overview cards.
  return (
    <CollapsibleDetailCard
      icon={Network}
      title="Dependencies"
      count={hasAny ? total : undefined}
      collapsible={hasAny}
      bodyClassName="space-y-3 px-[var(--d-pad)] pb-[var(--d-pad)]"
    >
      {hasAny ? (
        <>
          {upstream.length > 0 && (
            <div>
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
                    systemName={system.name}
                    direction="depends-on"
                    healthStatus={healthStatuses[row.systemId]?.status}
                  />
                ))}
              </div>
            </div>
          )}

          {downstream.length > 0 && (
            <div>
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
                    systemName={system.name}
                    direction="depended-on-by"
                    healthStatus={healthStatuses[row.systemId]?.status}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          This system has no recorded dependencies.
        </p>
      )}
    </CollapsibleDetailCard>
  );
};
