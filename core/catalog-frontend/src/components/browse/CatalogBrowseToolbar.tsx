import React from "react";
import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
} from "@checkstack/ui";
import { Search, Rows3, Rows2 } from "lucide-react";
import type { Group } from "@checkstack/catalog-common";
import type {
  Density,
  HealthFilter,
} from "./browseState.logic";
import {
  UNGROUPED_ID,
  HealthFilterSchema,
  DensitySchema,
} from "./browseState.logic";

/**
 * Sentinel "all" value for the `Select` filters. Radix `Select` items cannot
 * carry an empty-string value, so a non-empty token stands in for "no filter".
 */
const ALL = "__all__";

const DENSITY_TABS = [
  { id: "comfortable", label: "Comfortable", icon: <Rows3 className="h-4 w-4" /> },
  { id: "compact", label: "Compact", icon: <Rows2 className="h-4 w-4" /> },
];

const HEALTH_OPTIONS: { value: HealthFilter; label: string }[] = [
  { value: "all", label: "All health" },
  { value: "healthy", label: "Healthy" },
  { value: "degraded", label: "Degraded" },
  { value: "unhealthy", label: "Unhealthy" },
  { value: "unknown", label: "Unknown" },
];

export interface CatalogBrowseToolbarProps {
  query: string;
  onQueryChange: (query: string) => void;
  group: string | null;
  onGroupChange: (group: string | null) => void;
  groups: Group[];
  health: HealthFilter;
  onHealthChange: (health: HealthFilter) => void;
  /** `true` once the health slot is filled (Phase 4); disables the filter otherwise. */
  healthEnabled?: boolean;
  tag: string | null;
  onTagChange: (tag: string | null) => void;
  tagOptions: string[];
  /**
   * Density control. Optional: surfaces that render density-aware rows (browse)
   * pass both; surfaces whose rows are not density-aware (the management lists)
   * omit them, hiding the toggle rather than showing a dead control.
   */
  density?: Density;
  onDensityChange?: (density: Density) => void;
}

/**
 * Shared browse/manage toolbar: search input + group/health/tag filters + a
 * comfortable/compact density toggle. Pure controlled component — all state is
 * lifted to the page via `useCatalogBrowseState`.
 */
export const CatalogBrowseToolbar: React.FC<CatalogBrowseToolbarProps> = ({
  query,
  onQueryChange,
  group,
  onGroupChange,
  groups,
  health,
  onHealthChange,
  healthEnabled = false,
  tag,
  onTagChange,
  tagOptions,
  density,
  onDensityChange,
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
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search systems and groups"
          aria-label="Search systems and groups"
          className="pl-9"
        />
      </div>

      <Select
        value={group ?? ALL}
        onValueChange={(value) => onGroupChange(value === ALL ? null : value)}
      >
        <SelectTrigger className="md:w-44" aria-label="Filter by group">
          <SelectValue placeholder="All groups" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All groups</SelectItem>
          {groups.map((g) => (
            <SelectItem key={g.id} value={g.id}>
              {g.name}
            </SelectItem>
          ))}
          <SelectItem value={UNGROUPED_ID}>Ungrouped</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={health}
        onValueChange={(value) => onHealthChange(HealthFilterSchema.parse(value))}
        disabled={!healthEnabled}
      >
        <SelectTrigger
          className="md:w-40"
          aria-label="Filter by health"
          title={
            healthEnabled
              ? undefined
              : "Health filtering becomes available once a health source is installed"
          }
        >
          <SelectValue placeholder="All health" />
        </SelectTrigger>
        <SelectContent>
          {HEALTH_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {tagOptions.length > 0 && (
        <Select
          value={tag ?? ALL}
          onValueChange={(value) => onTagChange(value === ALL ? null : value)}
        >
          <SelectTrigger className="md:w-44" aria-label="Filter by tag">
            <SelectValue placeholder="All tags" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All tags</SelectItem>
            {tagOptions.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {density !== undefined && onDensityChange && (
        <Tabs
          items={DENSITY_TABS}
          activeTab={density}
          onTabChange={(id) => onDensityChange(DensitySchema.parse(id))}
          className="md:w-auto"
        />
      )}
    </div>
  );
};
