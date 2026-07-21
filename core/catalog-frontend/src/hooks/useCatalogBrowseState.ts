import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  parseBrowseState,
  serializeBrowseState,
  type BrowseState,
  type Density,
  type HealthFilter,
} from "../components/browse/browseState.logic";
import { useDebouncedValue } from "@checkstack/ui";

const QUERY_DEBOUNCE_MS = 150;

export interface CatalogBrowseStateApi {
  /** Live state reflecting the URL (query updates immediately for the input). */
  state: BrowseState;
  /** Query debounced for filtering, so typing stays smooth on large lists. */
  debouncedQuery: string;
  setQuery: (query: string) => void;
  setGroup: (group: string | null) => void;
  setHealth: (health: HealthFilter) => void;
  setTag: (tag: string | null) => void;
  setDensity: (density: Density) => void;
  /** Force a section's open/closed state (overrides the default policy). */
  setSectionOpen: (id: string, open: boolean) => void;
  /** Clear every filter (query/group/health/tag) but keep density + open. */
  clearFilters: () => void;
}

/**
 * Bridge between the browse URL params and the page. All persistence logic
 * lives in `browseState.logic.ts` (DOM-free, tested); this hook only wires it
 * to `useSearchParams` and adds query debouncing.
 */
export function useCatalogBrowseState(): CatalogBrowseStateApi {
  const [searchParams, setSearchParams] = useSearchParams();

  const state = useMemo(
    () => parseBrowseState(searchParams),
    [searchParams],
  );

  const debouncedQuery = useDebouncedValue(state.query, QUERY_DEBOUNCE_MS);

  const commit = useCallback(
    (next: BrowseState) => {
      const serialized = serializeBrowseState(next);
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

  const setQuery = useCallback(
    (query: string) => commit({ ...state, query }),
    [commit, state],
  );
  const setGroup = useCallback(
    (group: string | null) => commit({ ...state, group }),
    [commit, state],
  );
  const setHealth = useCallback(
    (health: HealthFilter) => commit({ ...state, health }),
    [commit, state],
  );
  const setTag = useCallback(
    (tag: string | null) => commit({ ...state, tag }),
    [commit, state],
  );
  const setDensity = useCallback(
    (density: Density) => commit({ ...state, density }),
    [commit, state],
  );
  const setSectionOpen = useCallback(
    (id: string, open: boolean) =>
      commit({ ...state, open: { ...state.open, [id]: open } }),
    [commit, state],
  );
  const clearFilters = useCallback(
    () => commit({ ...state, query: "", group: null, health: "all", tag: null }),
    [commit, state],
  );

  return {
    state,
    debouncedQuery,
    setQuery,
    setGroup,
    setHealth,
    setTag,
    setDensity,
    setSectionOpen,
    clearFilters,
  };
}
