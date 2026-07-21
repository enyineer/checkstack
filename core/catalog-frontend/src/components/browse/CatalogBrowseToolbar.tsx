import React, { useMemo } from "react";
import {
  DataTableFilterBar,
  Tabs,
  type DataTableFilterState,
} from "@checkstack/ui";
import { Rows3, Rows2 } from "lucide-react";
import type { Group } from "@checkstack/catalog-common";
import { DensitySchema, type Density } from "./browseState.logic";
import { buildCatalogFacets } from "./catalogFacets.logic";

const DENSITY_TABS = [
  { id: "comfortable", label: "Comfortable", icon: <Rows3 className="h-4 w-4" /> },
  { id: "compact", label: "Compact", icon: <Rows2 className="h-4 w-4" /> },
];

export interface CatalogBrowseToolbarProps {
  /** Live filter state (drives the controls; typing must feel instant). */
  filters: DataTableFilterState;
  onFiltersChange: (next: DataTableFilterState) => void;
  onClear: () => void;
  /** Groups offered by the group control. */
  groups: Group[];
  /** `key=value` tokens offered by the tag control (empty hides it). */
  tagOptions: string[];
  /** `true` once the health slot is filled; disables the control otherwise. */
  healthEnabled?: boolean;
  /**
   * Density control. Optional: surfaces that render density-aware rows (browse)
   * pass both; surfaces whose rows are not density-aware (the management lists)
   * omit them, hiding the toggle rather than showing a dead control.
   */
  density?: Density;
  onDensityChange?: (density: Density) => void;
}

/**
 * Shared browse/manage toolbar: the standard `DataTableFilterBar` (search +
 * group/health/tag facets + Clear) with the catalog's density toggle in its
 * `children` slot.
 *
 * Density rides in the bar rather than beside it because that is where it has
 * always sat visually — but it goes through `children`, not `facets`, because
 * it narrows NOTHING: it changes how surviving rows are drawn. Modelling it as
 * a facet would put it behind Clear and count it as an active filter, so
 * "clear filters" would silently reset the reader's row height too.
 *
 * Pure controlled component — all state is lifted to the page via
 * `useCatalogBrowseState`, since one toolbar drives the browse grid on one page
 * and all three management tabs on the other.
 */
export const CatalogBrowseToolbar: React.FC<CatalogBrowseToolbarProps> = ({
  filters,
  onFiltersChange,
  onClear,
  groups,
  tagOptions,
  healthEnabled = false,
  density,
  onDensityChange,
}) => {
  const facets = useMemo(
    () => buildCatalogFacets({ groups, tagOptions, healthEnabled }),
    [groups, tagOptions, healthEnabled],
  );

  return (
    <DataTableFilterBar
      filters={filters}
      onFiltersChange={onFiltersChange}
      onClear={onClear}
      facets={facets}
      searchPlaceholder="Search systems and groups"
    >
      {density !== undefined && onDensityChange && (
        <Tabs
          items={DENSITY_TABS}
          activeTab={density}
          onTabChange={(id) => onDensityChange(DensitySchema.parse(id))}
          className="md:w-auto"
        />
      )}
    </DataTableFilterBar>
  );
};
