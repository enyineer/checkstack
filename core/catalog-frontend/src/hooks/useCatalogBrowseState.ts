import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";
import {
  useDataTableFilters,
  type DataTableFiltersApi,
} from "@checkstack/ui";
import {
  catalogFacetIds,
  parseViewState,
  serializeViewState,
  toCatalogFilters,
  type CatalogFilters,
  type CatalogViewState,
  type Density,
} from "../components/browse/browseState.logic";

export interface CatalogBrowseStateApi {
  /**
   * The shared URL-backed filter state (search + group/health/tag facets).
   * Drive the toolbar from `filters.state`, and read `filters.active` to gate
   * controls a filtered view makes ambiguous (the Groups tab's reorder arrows).
   */
  filters: DataTableFiltersApi;
  /**
   * The filters as catalog domain values, with the query DEBOUNCED. This is
   * what the pure filter logic consumes, so typing stays smooth on large lists
   * while the input itself still updates on every keystroke.
   */
  applied: CatalogFilters;
  /** Density + open sections: catalog-specific, no facet can express them. */
  view: CatalogViewState;
  setDensity: (density: Density) => void;
  /** Force a section's open/closed state (overrides the default policy). */
  setSectionOpen: (id: string, open: boolean) => void;
}

/**
 * Browse/manage state for the catalog pages.
 *
 * The search box and the three row filters are the shared
 * `useDataTableFilters` state, so the catalog filters exactly like every other
 * list surface and its links keep working (the facet ids are the browse view's
 * long-standing param names). What remains here is the catalog's own view
 * state — row density and which group sections are open — which the facet
 * model has no concept of; its persistence logic lives DOM-free in
 * `browseState.logic.ts` and this hook only wires it to `useSearchParams`.
 *
 * One call per page: the management page's single toolbar drives all three
 * tabs, so the state must be lifted above them rather than owned per tab.
 */
export function useCatalogBrowseState(): CatalogBrowseStateApi {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useDataTableFilters({ facetIds: catalogFacetIds });

  const view = useMemo(() => parseViewState(searchParams), [searchParams]);

  const applied = useMemo(
    () => toCatalogFilters(filters.debounced),
    [filters.debounced],
  );

  const commitView = useCallback(
    (next: CatalogViewState) => {
      const serialized = serializeViewState(next);
      setSearchParams(
        (prev) => {
          const updated = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(serialized)) {
            if (value.length > 0) {
              updated.set(key, value);
            } else {
              updated.delete(key);
            }
          }
          return updated;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setDensity = useCallback(
    (density: Density) => commitView({ ...view, density }),
    [commitView, view],
  );
  const setSectionOpen = useCallback(
    (id: string, open: boolean) =>
      commitView({ ...view, open: { ...view.open, [id]: open } }),
    [commitView, view],
  );

  return { filters, applied, view, setDensity, setSectionOpen };
}
