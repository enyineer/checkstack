import React from "react";
import { useSearchParams } from "react-router-dom";
import {
  EMPTY_TABLE_FILTERS,
  hasActiveTableFilters,
  parseTableFilters,
  serializeTableFilters,
  type DataTableFilterState,
} from "../components/DataTable/facets.logic";
import { useDebouncedValue } from "./useDebouncedValue";

/** Keeps a fast typist from re-filtering a large list on every keystroke. */
const QUERY_DEBOUNCE_MS = 150;

export interface DataTableFiltersApi {
  /**
   * Live state, reflecting the URL immediately. Drive the CONTROLS from this
   * (hand it to `DataTable`'s `filters` prop) so typing feels instant.
   */
  state: DataTableFilterState;
  /**
   * The same state with the query debounced. Use this when YOU do the
   * filtering - a server-side query input, or a list that is not a `DataTable`.
   * `DataTable` debounces internally, so a plain table wants `state`.
   *
   * Facet selections are never debounced: they are discrete clicks, and
   * delaying them just reads as lag.
   */
  debounced: DataTableFilterState;
  setState: (next: DataTableFilterState) => void;
  /** Reset every facet and the search. */
  clear: () => void;
  /** Whether anything currently narrows the list. */
  active: boolean;
}

/**
 * Filter state for a {@link DataTable}, persisted in the URL.
 *
 * The URL is the default home for this state because a filtered view is
 * something people SHARE and come back to: a link to "the failing checks in
 * production" should reopen filtered, a reload should not silently drop back to
 * everything, and following a row into its detail page and back should return
 * you to the list you were looking at. Two of the three most mature filter
 * implementations in this repo had already arrived at URL params independently.
 *
 * Requires a router. A `DataTable` given `facets` but no `filters` still filters
 * - it falls back to internal component state - so a story or an isolated render
 * is never forced to set up routing just to be filterable.
 *
 * @param paramPrefix Namespaces the parameters so two filtered tables on one
 * page cannot fight over `q`. Omit for a page's primary table.
 */
export function useDataTableFilters({
  facetIds,
  paramPrefix,
  debounceMs = QUERY_DEBOUNCE_MS,
}: {
  facetIds: readonly string[];
  paramPrefix?: string;
  debounceMs?: number;
}): DataTableFiltersApi {
  const [searchParams, setSearchParams] = useSearchParams();

  // `facetIds` is typically an inline array literal, so a fresh reference
  // arrives on every parent render. Key the memos on its CONTENT instead, or
  // every render re-parses and hands back a new state object.
  const facetKey = facetIds.join(",");
  const stableFacetIds = React.useMemo(
    () => (facetKey.length > 0 ? facetKey.split(",") : []),
    [facetKey],
  );

  const state = React.useMemo(
    () =>
      parseTableFilters({
        params: searchParams,
        facetIds: stableFacetIds,
        prefix: paramPrefix,
      }),
    [searchParams, stableFacetIds, paramPrefix],
  );

  const setState = React.useCallback(
    (next: DataTableFilterState) => {
      const serialized = serializeTableFilters({
        state: next,
        facetIds: stableFacetIds,
        prefix: paramPrefix,
      });
      setSearchParams(
        (prev) => {
          const updated = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(serialized)) {
            // Empty means "remove", so an unfiltered table leaves the URL
            // exactly as it found it rather than trailing `?q=&status=`.
            if (value.length > 0) updated.set(key, value);
            else updated.delete(key);
          }
          return updated;
        },
        // `replace` so filtering does not stack history entries the user then
        // has to press Back through one keystroke at a time.
        { replace: true },
      );
    },
    [setSearchParams, stableFacetIds, paramPrefix],
  );

  const clear = React.useCallback(
    () => setState(EMPTY_TABLE_FILTERS),
    [setState],
  );

  const debouncedQuery = useDebouncedValue(state.query, debounceMs);
  const debounced = React.useMemo(
    () => ({ query: debouncedQuery, facets: state.facets }),
    [debouncedQuery, state.facets],
  );

  return {
    state,
    debounced,
    setState,
    clear,
    active: hasActiveTableFilters(state),
  };
}
