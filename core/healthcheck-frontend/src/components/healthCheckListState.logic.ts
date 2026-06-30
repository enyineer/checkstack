import { z } from "zod";
import type { HealthCheckConfiguration } from "@checkstack/healthcheck-common";

/**
 * Health-check overview list view state — DOM-free serialise/parse/filter/sort
 * logic for the "Health Checks" config page. All list state (search query,
 * strategy / status / system filters) is ephemeral UI state held in URL params
 * so a shared link reopens the same view. This module owns the single source
 * of truth for the param names and their defaults; the React hook
 * (`useHealthCheckListState`) is a thin wrapper over these pure functions.
 *
 * Mirrors the catalog browse state pattern (see
 * `core/catalog-frontend/src/components/browse/browseState.logic.ts`) so the
 * two list surfaces share the same conventions.
 */

/** URL param keys used by the health-check list view. Centralised to avoid typos. */
export const HEALTHCHECK_LIST_PARAM = {
  query: "q",
  strategy: "strategy",
  status: "status",
  system: "system",
} as const;

/**
 * Status filter values. The list shows Active vs Paused (derived from
 * `config.paused`); there is no run-level health status on this surface.
 */
export const StatusFilterSchema = z.enum(["all", "active", "paused"]);
export type StatusFilter = z.infer<typeof StatusFilterSchema>;

/** The fully-parsed health-check list view state. */
export interface HealthCheckListState {
  /** Free-text search over the configuration name. */
  query: string;
  /** Narrow to a single strategy id, or `null` for "all strategies". */
  strategyId: string | null;
  /** Active/paused filter. */
  status: StatusFilter;
  /**
   * Narrow to checks assigned to a specific system id, or `null` for
   * "all systems". A configuration has no `systemId` field of its own; the
   * assignment is a separate entity, so the caller resolves the set of
   * assigned configuration ids for the selected system and passes it to
   * {@link filterAndSortHealthChecks} via `assignedConfigIds`.
   */
  systemId: string | null;
}

/** Default state when no params are present. */
export const DEFAULT_HEALTHCHECK_LIST_STATE: HealthCheckListState = {
  query: "",
  strategyId: null,
  status: "all",
  systemId: null,
};

/**
 * Parse health-check list state from a `URLSearchParams`-like reader. Invalid
 * or absent values fall back to defaults so a hand-edited URL never throws.
 */
export function parseHealthCheckListState(params: {
  get: (key: string) => string | null;
}): HealthCheckListState {
  const query = params.get(HEALTHCHECK_LIST_PARAM.query) ?? "";
  const strategy = params.get(HEALTHCHECK_LIST_PARAM.strategy);
  const system = params.get(HEALTHCHECK_LIST_PARAM.system);

  const statusRaw = params.get(HEALTHCHECK_LIST_PARAM.status);
  const status = StatusFilterSchema.safeParse(statusRaw);

  return {
    query,
    strategyId: strategy && strategy.length > 0 ? strategy : null,
    status: status.success ? status.data : DEFAULT_HEALTHCHECK_LIST_STATE.status,
    systemId: system && system.length > 0 ? system : null,
  };
}

/**
 * Compute the param mutations to apply for a given list state. Returns a map
 * of param key → value where an empty string means "delete this param" (so the
 * URL stays clean and a default state produces no params at all). The React
 * hook applies these against the live `URLSearchParams`.
 */
export function serializeHealthCheckListState(
  state: HealthCheckListState,
): Record<string, string> {
  return {
    [HEALTHCHECK_LIST_PARAM.query]: state.query,
    [HEALTHCHECK_LIST_PARAM.strategy]: state.strategyId ?? "",
    [HEALTHCHECK_LIST_PARAM.status]:
      state.status === DEFAULT_HEALTHCHECK_LIST_STATE.status ? "" : state.status,
    [HEALTHCHECK_LIST_PARAM.system]: state.systemId ?? "",
  };
}

/** Case-insensitive substring match, null-safe. */
function matchesText(haystack: string, needle: string): boolean {
  if (!needle) return true;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/** Does a configuration pass the status filter? */
function matchesStatus(
  config: HealthCheckConfiguration,
  status: StatusFilter,
): boolean {
  if (status === "all") return true;
  if (status === "active") return !config.paused;
  return config.paused;
}

/**
 * Filter and sort health-check configurations for the overview list.
 *
 * - `query` matches the configuration name (case-insensitive substring).
 * - `strategyId` narrows to a single strategy (exact id match).
 * - `status` filters active vs paused.
 * - `systemId` narrows to checks assigned to a system. Since a configuration
 *   carries no system field, the caller resolves the assigned config id set
 *   for the selected system and passes it as `assignedConfigIds`; when the
 *   system filter is active (`systemId` set) only configs whose id appears in
 *   that set survive. `assignedConfigIds` may be `undefined` while the
 *   assignment query is still loading — in that case nothing is shown until
 *   the set resolves (avoids a flash of unfiltered rows).
 * - Results are sorted by name (case-insensitive, locale-aware) so the list
 *   reads predictably regardless of insertion order.
 */
export function filterAndSortHealthChecks({
  configurations,
  state,
  assignedConfigIds,
}: {
  configurations: HealthCheckConfiguration[];
  state: HealthCheckListState;
  /**
   * Config ids assigned to the selected system. Resolved by the caller from
   * `getSystemConfigurations({ systemId })` when `state.systemId` is set;
   * `undefined` while that query is still loading, `null` when no system
   * filter is active.
   */
  assignedConfigIds?: Set<string> | null;
}): HealthCheckConfiguration[] {
  const systemFilterActive = state.systemId !== null;

  const filtered = configurations.filter((config) => {
    if (!matchesText(config.name, state.query)) return false;
    if (state.strategyId !== null && config.strategyId !== state.strategyId)
      return false;
    if (!matchesStatus(config, state.status)) return false;
    if (systemFilterActive) {
      const ids = assignedConfigIds;
      // While the assignment set is loading (`undefined`), show nothing rather
      // than the unfiltered superset — avoids a misleading flash of all checks.
      // A resolved set (`null` shouldn't happen while the filter is active, but
      // is treated as "no matches" defensively) gates each config by id.
      if (!ids) return false;
      if (!ids.has(config.id)) return false;
    }
    return true;
  });

  return filtered.toSorted((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

/**
 * `true` when any filter is active (query / strategy / status / system). Used
 * by the page to decide whether an empty list is "filtered to empty" (show a
 * clear-filters affordance) vs a genuinely empty catalog.
 */
export function hasActiveHealthCheckFilter(
  state: HealthCheckListState,
): boolean {
  return (
    state.query.trim().length > 0 ||
    state.strategyId !== null ||
    state.status !== "all" ||
    state.systemId !== null
  );
}
