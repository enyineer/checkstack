import { z } from "zod";
import { parsedFacetValue, type DataTableFilterState } from "@checkstack/ui";

/**
 * Browse-view URL/view state — DOM-free parse/serialise logic for the catalog
 * browse page.
 *
 * The search box and the group/health/tag filters are now owned by the shared
 * `useDataTableFilters` hook, which round-trips them through the URL under the
 * facet ids declared here. What stays catalog-specific is the state the facet
 * model has no concept of: row `density` and which group sections are open. This
 * module owns the param names for BOTH halves, so the whole URL contract of a
 * shared browse link is still readable in one place.
 */

/**
 * URL param keys used by the browse view. Centralised to avoid typos, and
 * FROZEN: these names appear in links people have already shared, so a rename
 * silently breaks every one of them.
 */
export const BROWSE_PARAM = {
  query: "q",
  group: "group",
  health: "health",
  tag: "tag",
  density: "density",
  open: "open",
} as const;

/**
 * The facet ids handed to `useDataTableFilters`. A facet id doubles as its URL
 * parameter name, which is what keeps the migrated toolbar link-compatible with
 * the hand-rolled one it replaced. (`BROWSE_PARAM.query` matching the shared
 * hook's own `q` is guarded by a test.)
 */
export const catalogFacetIds = [
  BROWSE_PARAM.group,
  BROWSE_PARAM.health,
  BROWSE_PARAM.tag,
] as const;

/**
 * Health filter values. The "show everything" case is the ABSENCE of a value
 * (the shared `any` sentinel), not a member of this enum, so the schema lists
 * only real statuses and a system's health can be compared to it directly.
 */
export const HealthFilterSchema = z.enum([
  "healthy",
  "degraded",
  "unhealthy",
  "unknown",
]);
export type HealthFilter = z.infer<typeof HealthFilterSchema>;

/** Row density. `comfortable` shows descriptions inline; `compact` is dense. */
export const DensitySchema = z.enum(["comfortable", "compact"]);
export type Density = z.infer<typeof DensitySchema>;

/** The row filters, read back out of the shared facet state as domain values. */
export interface CatalogFilters {
  /** Free-text search over system + group name and description. */
  query: string;
  /** Narrow to a single group id (or {@link UNGROUPED_ID}), `null` for all. */
  group: string | null;
  /** Narrow to one reported health status, `null` for all. */
  health: HealthFilter | null;
  /** Metadata tag/value filter token, or `null` for none. */
  tag: string | null;
}

/** The catalog-specific view state, which no facet can express. */
export interface CatalogViewState {
  /** Row density. */
  density: Density;
  /**
   * Explicitly-toggled group sections, by id. A value of `true` means the user
   * forced-open, `false` means forced-closed. Groups absent from the map fall
   * back to the computed default-open policy.
   */
  open: Record<string, boolean>;
}

/** Everything the browse model needs: the filters plus the view state. */
export interface BrowseState extends CatalogFilters, CatalogViewState {}

/** The unconstrained filters. */
export const NO_CATALOG_FILTERS: CatalogFilters = {
  query: "",
  group: null,
  health: null,
  tag: null,
};

/** Default view state when no params are present. */
export const DEFAULT_VIEW_STATE: CatalogViewState = {
  density: "comfortable",
  open: {},
};

/** Default state when no params are present. */
export const DEFAULT_BROWSE_STATE: BrowseState = {
  ...NO_CATALOG_FILTERS,
  ...DEFAULT_VIEW_STATE,
};

/**
 * Synthetic id for the "Ungrouped" section so it can participate in the same
 * open/closed URL state as real groups. Chosen to never collide with a real
 * group id (group ids are opaque server-generated strings, never this token).
 */
export const UNGROUPED_ID = "__ungrouped__";

/**
 * Read the shared facet state back as catalog domain values.
 *
 * Facet selections are stringly-typed (they round-trip through the URL and
 * through `<Select>`), so health is PARSED rather than cast: a hand-edited or
 * stale link yields `null` — unconstrained — instead of a filter no system can
 * ever match. Group and tag are opaque ids/tokens with no schema to check; a
 * value naming something that no longer exists simply matches nothing, which is
 * the honest answer for "the group I linked to was deleted".
 */
export function toCatalogFilters(state: DataTableFilterState): CatalogFilters {
  return {
    query: state.query,
    group: state.facets[BROWSE_PARAM.group] ?? null,
    health:
      parsedFacetValue({
        filters: state,
        facetId: BROWSE_PARAM.health,
        schema: HealthFilterSchema,
      }) ?? null,
    tag: state.facets[BROWSE_PARAM.tag] ?? null,
  };
}

/** Does anything narrow the entity lists? Drives the filtered-empty states. */
export function hasCatalogFilters(filters: CatalogFilters): boolean {
  return (
    filters.query.trim().length > 0 ||
    filters.group !== null ||
    filters.health !== null ||
    filters.tag !== null
  );
}

/**
 * Parse the catalog's own view state from a `URLSearchParams`-like reader.
 * Invalid or absent values fall back to defaults so a hand-edited URL never
 * throws.
 */
export function parseViewState(params: {
  get: (key: string) => string | null;
}): CatalogViewState {
  const density = DensitySchema.safeParse(params.get(BROWSE_PARAM.density));
  return {
    density: density.success ? density.data : DEFAULT_VIEW_STATE.density,
    open: parseOpenParam(params.get(BROWSE_PARAM.open)),
  };
}

/**
 * Parse the `?open=` param. Encoding: a comma-separated list of group ids,
 * each optionally prefixed with `-` to mean "force-closed". E.g.
 * `?open=payments,-platform` → payments forced open, platform forced closed.
 */
export function parseOpenParam(
  value: string | null | undefined,
): Record<string, boolean> {
  if (!value) return {};
  const result: Record<string, boolean> = {};
  for (const rawToken of value.split(",")) {
    const token = rawToken.trim();
    if (token.length === 0) continue;
    if (token.startsWith("-")) {
      const id = token.slice(1);
      if (id.length > 0) result[id] = false;
    } else {
      result[token] = true;
    }
  }
  return result;
}

/**
 * Serialise the `open` map back to the `?open=` token form. Stable, sorted
 * order so URLs are deterministic (good for testing + shareable links).
 */
export function serializeOpenParam(open: Record<string, boolean>): string {
  return Object.keys(open)
    .toSorted()
    .map((id) => (open[id] ? id : `-${id}`))
    .join(",");
}

/**
 * Compute the param mutations for a view state. Returns a map of param key →
 * value where an empty string means "delete this param" (so a default view
 * produces no params at all). Same convention as the shared filter hook's
 * serialiser, since both write into the same `URLSearchParams`.
 */
export function serializeViewState(
  state: CatalogViewState,
): Record<string, string> {
  return {
    [BROWSE_PARAM.density]:
      state.density === DEFAULT_VIEW_STATE.density ? "" : state.density,
    [BROWSE_PARAM.open]: serializeOpenParam(state.open),
  };
}
