import React from "react";
import {
  HealthCheckConfiguration,
  HealthCheckStrategyDto,
  healthCheckAccess,
  healthCheckResourceTypes,
} from "@checkstack/healthcheck-common";
import { accessApiRef, useApi } from "@checkstack/frontend-api";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Skeleton,
  DataTable,
  type DataTableColumn,
  type DataTableFacetControl,
  type DataTableFilterState,
  RowActions,
  RowAction,
  Card,
  cn,
} from "@checkstack/ui";
import { Trash2, Edit, Pause, Play } from "lucide-react";
import { useProvenanceLocks } from "@checkstack/gitops-frontend";
import {
  HEALTHCHECK_SEARCH_PLACEHOLDER,
  HEALTHCHECK_STATUS_OPTIONS,
  strategyFilterOptions,
} from "./healthCheckFacets";
import { HealthStatusPill } from "./HealthStatusPill";
import { pausedToTone, toneStyles } from "./healthcheckDisplay.logic";

interface HealthCheckListProps {
  /** The FULL row set. The table filters; do not pre-filter this. */
  configurations: HealthCheckConfiguration[];
  strategies: HealthCheckStrategyDto[];
  onEdit: (config: HealthCheckConfiguration) => void;
  onDelete: (id: string) => void;
  onPause?: (id: string) => void;
  onResume?: (id: string) => void;
  /** Controlled filter state (URL-backed), so the page can read it. */
  filters: DataTableFilterState;
  onFiltersChange: (next: DataTableFilterState) => void;
  onClearFilters: () => void;
  /**
   * Dimensions no column owns - here the assigned SYSTEM, which is applied
   * server-side by swapping the data source, so it has no row accessor.
   */
  facets?: ReadonlyArray<DataTableFacetControl>;
  /** Shown when the filters leave no rows. */
  noResultsState?: React.ReactNode;
}

export const HealthCheckList: React.FC<HealthCheckListProps> = ({
  configurations,
  strategies,
  onEdit,
  onDelete,
  onPause,
  onResume,
  filters,
  onFiltersChange,
  onClearFilters,
  facets,
  noResultsState,
}) => {
  const accessApi = useApi(accessApiRef);
  // Per-resource action gate: ORs the global manage rule with a team grant on
  // each specific configuration, so team-scoped managers see row actions only
  // for the checks they own while global managers see them for all.
  const { canAccess } = accessApi.useResourceAccess({
    accessRule: healthCheckAccess.configuration.manage,
    objectType: healthCheckResourceTypes.configuration,
    resourceIds: configurations.map((c) => c.id),
  });
  // One bulk provenance query for every row; `getLock` is a plain lookup safe
  // to call from column cell renderers (which cannot call hooks).
  const { getLock } = useProvenanceLocks();

  const getStrategyName = (id: string) => {
    return strategies.find((s) => s.id === id)?.displayName || id;
  };

  const columns: DataTableColumn<HealthCheckConfiguration>[] = [
    {
      id: "name",
      header: "Name",
      cellClassName: "font-medium",
      sortValue: (config) => config.name,
      searchValue: (config) => config.name,
      cell: (config) => config.name,
    },
    {
      id: "strategy",
      header: "Strategy",
      sortValue: (config) => getStrategyName(config.strategyId),
      // Options come from the strategy registry, so a newly installed strategy
      // appears without a second list to maintain.
      filterValue: (config) => config.strategyId,
      filterOptions: strategyFilterOptions({ strategies }),
      filterAnyLabel: "All strategies",
      cell: (config) => getStrategyName(config.strategyId),
    },
    {
      id: "interval",
      header: "Interval (s)",
      sortValue: (config) => config.intervalSeconds,
      cell: (config) => config.intervalSeconds,
    },
    {
      id: "status",
      header: "Status",
      sortValue: (config) => (config.paused ? "Paused" : "Active"),
      // Active/paused is DERIVED from `paused`; there is no run-level health
      // status on this surface.
      filterValue: (config) => (config.paused ? "paused" : "active"),
      filterOptions: HEALTHCHECK_STATUS_OPTIONS,
      filterAnyLabel: "All statuses",
      cell: (config) => (
        <HealthStatusPill
          tone={pausedToTone({ paused: config.paused })}
          label={config.paused ? "Paused" : "Active"}
        />
      ),
    },
    {
      id: "actions",
      header: "Actions",
      headClassName: "text-right",
      cellClassName: "text-right",
      cell: (config) => (
        <HealthCheckActionButtons
          config={config}
          isLocked={
            getLock({ kind: "Healthcheck", entityId: config.id }).isLocked
          }
          onEdit={onEdit}
          onDelete={onDelete}
          onPause={onPause}
          onResume={onResume}
          canManage={canAccess(config.id)}
        />
      ),
    },
  ];

  return (
    <DataTable
      data={configurations}
      columns={columns}
      getRowId={(config) => config.id}
      // The Name/Strategy/Status columns declare their own search and filters;
      // the assigned-system control comes in via `facets` because it has no row
      // to read (it is applied server-side).
      facets={facets}
      filters={filters}
      onFiltersChange={onFiltersChange}
      onClearFilters={onClearFilters}
      searchPlaceholder={HEALTHCHECK_SEARCH_PLACEHOLDER}
      // Alphabetical by name: the list used to be sorted before it reached the
      // table, and a stable reading order beats insertion order here.
      defaultSort={{ columnId: "name", direction: "asc" }}
      noResultsState={noResultsState}
      getRowProps={(config) => ({
        className: config.paused ? "opacity-60" : undefined,
      })}
      renderMobileCard={(config) => (
        <HealthCheckMobileCard
          config={config}
          strategyName={getStrategyName(config.strategyId)}
          isLocked={
            getLock({ kind: "Healthcheck", entityId: config.id }).isLocked
          }
          onEdit={onEdit}
          onDelete={onDelete}
          onPause={onPause}
          onResume={onResume}
          canManage={canAccess(config.id)}
        />
      )}
    />
  );
};

interface HealthCheckListSkeletonProps {
  /**
   * Number of placeholder rows to render. Defaults to 4 so the skeleton
   * roughly matches a typical first-page configuration list.
   */
  rows?: number;
}

/**
 * HealthCheckListSkeleton mirrors the shape of {@link HealthCheckList} so
 * the page doesn't jump on load. Renders the same table chrome with
 * `Skeleton` placeholders in each cell on desktop, and a stacked card
 * skeleton on mobile to mirror the {@link HealthCheckList} mobile cards.
 */
export const HealthCheckListSkeleton: React.FC<
  HealthCheckListSkeletonProps
> = ({ rows = 4 }) => {
  return (
    <>
      <div className="hidden rounded-md border bg-card sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Strategy</TableHead>
              <TableHead>Interval (s)</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: rows }, (_, index) => (
              <TableRow key={index}>
                <TableCell>
                  <Skeleton className="h-4 w-32" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-24" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-12" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-5 w-16 rounded-full" />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Skeleton className="h-7 w-7" />
                    <Skeleton className="h-7 w-7" />
                    <Skeleton className="h-7 w-7" />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-2 sm:hidden">
        {Array.from({ length: rows }, (_, index) => (
          <Card key={index} className="p-3">
            <div className="flex items-center justify-between gap-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-12" />
            </div>
            <div className="mt-3 flex justify-end gap-1">
              <Skeleton className="h-7 w-7" />
              <Skeleton className="h-7 w-7" />
              <Skeleton className="h-7 w-7" />
            </div>
          </Card>
        ))}
      </div>
    </>
  );
};

interface HealthCheckMobileCardProps {
  config: HealthCheckConfiguration;
  strategyName: string;
  isLocked: boolean;
  onEdit: (config: HealthCheckConfiguration) => void;
  onDelete: (id: string) => void;
  onPause?: (id: string) => void;
  onResume?: (id: string) => void;
  canManage: boolean;
}

const HealthCheckMobileCard: React.FC<HealthCheckMobileCardProps> = ({
  config,
  strategyName,
  isLocked,
  onEdit,
  onDelete,
  onPause,
  onResume,
  canManage,
}) => {
  const tone = pausedToTone({ paused: config.paused });
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface p-[var(--d-pad)] shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]",
        config.paused && "opacity-60",
      )}
    >
      {/* Status accent stripe keyed to active/paused. */}
      <span
        className={cn("absolute inset-y-0 left-0 w-1", toneStyles[tone].accent)}
        aria-hidden
      />
      <div className="flex items-start justify-between gap-2 pl-2">
        <span className="truncate font-medium text-foreground">
          {config.name}
        </span>
        <HealthStatusPill
          tone={tone}
          label={config.paused ? "Paused" : "Active"}
        />
      </div>
      <div className="mt-1 pl-2 text-xs text-muted-foreground">
        {strategyName} &middot; every {config.intervalSeconds}s
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <HealthCheckActionButtons
          config={config}
          isLocked={isLocked}
          onEdit={onEdit}
          onDelete={onDelete}
          onPause={onPause}
          onResume={onResume}
          canManage={canManage}
        />
      </div>
    </div>
  );
};

interface HealthCheckActionButtonsProps {
  config: HealthCheckConfiguration;
  isLocked: boolean;
  onEdit: (config: HealthCheckConfiguration) => void;
  onDelete: (id: string) => void;
  onPause?: (id: string) => void;
  onResume?: (id: string) => void;
  canManage: boolean;
}

const HealthCheckActionButtons: React.FC<HealthCheckActionButtonsProps> = ({
  config,
  isLocked,
  onEdit,
  onDelete,
  onPause,
  onResume,
  canManage,
}) => (
  <RowActions>
    {canManage &&
      onPause &&
      onResume &&
      (config.paused ? (
        <RowAction
          icon={Play}
          label="Resume"
          onClick={() => onResume(config.id)}
          title={isLocked ? "Managed by GitOps" : "Resume health check"}
          disabled={isLocked}
        />
      ) : (
        <RowAction
          icon={Pause}
          label="Pause"
          onClick={() => onPause(config.id)}
          title={isLocked ? "Managed by GitOps" : "Pause health check"}
          disabled={isLocked}
        />
      ))}
    {canManage && (
      <RowAction
        icon={Edit}
        label="Edit configuration"
        onClick={() => onEdit(config)}
        title={
          isLocked
            ? "View configuration (Managed by GitOps)"
            : "Edit configuration"
        }
      />
    )}
    {canManage && (
      <RowAction
        icon={Trash2}
        label="Delete configuration"
        tone="destructive"
        onClick={() => onDelete(config.id)}
        disabled={isLocked}
        title={isLocked ? "Managed by GitOps" : "Delete configuration"}
      />
    )}
  </RowActions>
);
