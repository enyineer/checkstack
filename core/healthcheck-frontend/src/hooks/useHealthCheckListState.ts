import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  parseHealthCheckListState,
  serializeHealthCheckListState,
  type HealthCheckListState,
  type StatusFilter,
} from "../components/healthCheckListState.logic";
import { useDebouncedValue } from "./useDebouncedValue";

const QUERY_DEBOUNCE_MS = 150;

export interface HealthCheckListStateApi {
  /** Live state reflecting the URL (query updates immediately for the input). */
  state: HealthCheckListState;
  /** Query debounced for filtering, so typing stays smooth on large lists. */
  debouncedQuery: string;
  setQuery: (query: string) => void;
  setStrategy: (strategyId: string | null) => void;
  setStatus: (status: StatusFilter) => void;
  setSystem: (systemId: string | null) => void;
  /** Clear every filter (query/strategy/status/system). */
  clearFilters: () => void;
}

/**
 * Bridge between the health-check list URL params and the page. All
 * persistence logic lives in `healthCheckListState.logic.ts` (DOM-free,
 * tested); this hook only wires it to `useSearchParams` and adds query
 * debouncing.
 *
 * Mirrors `useCatalogBrowseState` from catalog-frontend.
 */
export function useHealthCheckListState(): HealthCheckListStateApi {
  const [searchParams, setSearchParams] = useSearchParams();

  const state = useMemo(
    () => parseHealthCheckListState(searchParams),
    [searchParams],
  );

  const debouncedQuery = useDebouncedValue(state.query, QUERY_DEBOUNCE_MS);

  const commit = useCallback(
    (next: HealthCheckListState) => {
      const serialized = serializeHealthCheckListState(next);
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
  const setStrategy = useCallback(
    (strategyId: string | null) => commit({ ...state, strategyId }),
    [commit, state],
  );
  const setStatus = useCallback(
    (status: StatusFilter) => commit({ ...state, status }),
    [commit, state],
  );
  const setSystem = useCallback(
    (systemId: string | null) => commit({ ...state, systemId }),
    [commit, state],
  );
  const clearFilters = useCallback(
    () =>
      commit({
        ...state,
        query: "",
        strategyId: null,
        status: "all",
        systemId: null,
      }),
    [commit, state],
  );

  return {
    state,
    debouncedQuery,
    setQuery,
    setStrategy,
    setStatus,
    setSystem,
    clearFilters,
  };
}
