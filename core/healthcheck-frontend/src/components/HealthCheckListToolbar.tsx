import React from "react";
import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Button,
} from "@checkstack/ui";
import { Search, X } from "lucide-react";
import type { HealthCheckStrategyDto } from "@checkstack/healthcheck-common";
import {
  StatusFilterSchema,
  type HealthCheckListState,
  type StatusFilter,
} from "./healthCheckListState.logic";

/**
 * Sentinel "all" value for the `Select` filters. Radix `Select` items cannot
 * carry an empty-string value, so a non-empty token stands in for "no filter".
 * (Same convention as `CatalogBrowseToolbar`.)
 */
const ALL = "__all__";

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
];

export interface HealthCheckListToolbarProps {
  state: HealthCheckListState;
  onQueryChange: (query: string) => void;
  onStrategyChange: (strategyId: string | null) => void;
  onStatusChange: (status: StatusFilter) => void;
  onSystemChange: (systemId: string | null) => void;
  onClearFilters: () => void;
  strategies: HealthCheckStrategyDto[];
  systems: { id: string; name: string }[];
  /**
   * `true` while the assigned-config-ids query for the selected system is
   * loading. Used to hint the system filter is resolving (no separate affordance
   * is rendered; the list itself shows nothing until the set resolves).
   */
  systemAssignmentsLoading?: boolean;
  /** Whether any filter is currently active (drives the clear-filters button). */
  hasActiveFilter: boolean;
}

/**
 * Health-check overview toolbar: search by name + strategy/status/system
 * filters + a clear-filters button. Pure controlled component — all state is
 * lifted to the page via `useHealthCheckListState`.
 *
 * Mirrors the catalog browse toolbar layout
 * (`core/catalog-frontend/src/components/browse/CatalogBrowseToolbar.tsx`).
 */
export const HealthCheckListToolbar: React.FC<HealthCheckListToolbarProps> = ({
  state,
  onQueryChange,
  onStrategyChange,
  onStatusChange,
  onSystemChange,
  onClearFilters,
  strategies,
  systems,
  systemAssignmentsLoading = false,
  hasActiveFilter,
}) => {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
      <div className="relative flex-1 min-w-[12rem]">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          value={state.query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search health checks"
          aria-label="Search health checks"
          className="pl-9"
        />
      </div>

      <Select
        value={state.strategyId ?? ALL}
        onValueChange={(value) =>
          onStrategyChange(value === ALL ? null : value)
        }
      >
        <SelectTrigger className="md:w-48" aria-label="Filter by strategy">
          <SelectValue placeholder="All strategies" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All strategies</SelectItem>
          {strategies.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.displayName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={state.status}
        onValueChange={(value) => onStatusChange(StatusFilterSchema.parse(value))}
      >
        <SelectTrigger className="md:w-40" aria-label="Filter by status">
          <SelectValue placeholder="All statuses" />
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={state.systemId ?? ALL}
        onValueChange={(value) => onSystemChange(value === ALL ? null : value)}
      >
        <SelectTrigger
          className="md:w-52"
          aria-label="Filter by assigned system"
          title={
            systemAssignmentsLoading
              ? "Loading assignments…"
              : "Show checks assigned to a system"
          }
        >
          <SelectValue placeholder="All systems" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All systems</SelectItem>
          {systems.map((sys) => (
            <SelectItem key={sys.id} value={sys.id}>
              {sys.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasActiveFilter && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onClearFilters}
          className="text-muted-foreground"
        >
          <X className="mr-1 h-4 w-4" /> Clear
        </Button>
      )}
    </div>
  );
};
