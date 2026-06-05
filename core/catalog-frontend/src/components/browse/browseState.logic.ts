import { z } from "zod";

/**
 * Browse-view URL/view state — DOM-free serialise/parse logic for the catalog
 * browse page. All browse state (search query, filters, density, which groups
 * are open) is ephemeral UI state held in URL params so a shared link reopens
 * the same view. This module owns the single source of truth for the param
 * names and their defaults; the React hook (`useCatalogBrowseState`) is a thin
 * wrapper over these pure functions.
 */

/** URL param keys used by the browse view. Centralised to avoid typos. */
export const BROWSE_PARAM = {
  query: "q",
  group: "group",
  health: "health",
  tag: "tag",
  density: "density",
  open: "open",
} as const;

/**
 * Health filter values. Phase 2 ships "counts only" (no health data), so the
 * filter is parsed and round-tripped but only `"all"` is actionable until the
 * Phase 4 health slot lands. Modelling it now keeps the URL contract stable.
 */
export const HealthFilterSchema = z.enum([
  "all",
  "healthy",
  "degraded",
  "unhealthy",
  "unknown",
]);
export type HealthFilter = z.infer<typeof HealthFilterSchema>;

/** Row density. `comfortable` shows descriptions inline; `compact` is dense. */
export const DensitySchema = z.enum(["comfortable", "compact"]);
export type Density = z.infer<typeof DensitySchema>;

/** The fully-parsed browse view state. */
export interface BrowseState {
  /** Free-text search over system + group name and description. */
  query: string;
  /** Narrow to a single group id, or `null` for "all groups". */
  group: string | null;
  /** Health filter (Phase 4); always `"all"` is meaningful in Phase 2. */
  health: HealthFilter;
  /** Metadata tag/value filter token, or `null` for none. */
  tag: string | null;
  /** Row density. */
  density: Density;
  /**
   * Explicitly-toggled group sections, by id. A value of `true` means the user
   * forced-open, `false` means forced-closed. Groups absent from the map fall
   * back to the computed default-open policy.
   */
  open: Record<string, boolean>;
}

/** Default state when no params are present. */
export const DEFAULT_BROWSE_STATE: BrowseState = {
  query: "",
  group: null,
  health: "all",
  tag: null,
  density: "comfortable",
  open: {},
};

/**
 * Synthetic id for the "Ungrouped" section so it can participate in the same
 * open/closed URL state as real groups. Chosen to never collide with a real
 * group id (group ids are opaque server-generated strings, never this token).
 */
export const UNGROUPED_ID = "__ungrouped__";

/**
 * Parse browse state from a `URLSearchParams`-like reader. Invalid or absent
 * values fall back to defaults so a hand-edited URL never throws.
 */
export function parseBrowseState(params: {
  get: (key: string) => string | null;
}): BrowseState {
  const query = params.get(BROWSE_PARAM.query) ?? "";
  const group = params.get(BROWSE_PARAM.group);
  const tag = params.get(BROWSE_PARAM.tag);

  const healthRaw = params.get(BROWSE_PARAM.health);
  const health = HealthFilterSchema.safeParse(healthRaw);

  const densityRaw = params.get(BROWSE_PARAM.density);
  const density = DensitySchema.safeParse(densityRaw);

  const openRaw = params.get(BROWSE_PARAM.open);

  return {
    query,
    group: group && group.length > 0 ? group : null,
    health: health.success ? health.data : DEFAULT_BROWSE_STATE.health,
    tag: tag && tag.length > 0 ? tag : null,
    density: density.success ? density.data : DEFAULT_BROWSE_STATE.density,
    open: parseOpenParam(openRaw),
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
 * Compute the param mutations to apply for a given browse state. Returns a map
 * of param key → value where an empty string means "delete this param" (so the
 * URL stays clean and a default state produces no params at all). The React
 * hook applies these against the live `URLSearchParams`.
 */
export function serializeBrowseState(state: BrowseState): Record<string, string> {
  const openSerialized = serializeOpenParam(state.open);
  return {
    [BROWSE_PARAM.query]: state.query,
    [BROWSE_PARAM.group]: state.group ?? "",
    [BROWSE_PARAM.health]:
      state.health === DEFAULT_BROWSE_STATE.health ? "" : state.health,
    [BROWSE_PARAM.tag]: state.tag ?? "",
    [BROWSE_PARAM.density]:
      state.density === DEFAULT_BROWSE_STATE.density ? "" : state.density,
    [BROWSE_PARAM.open]: openSerialized,
  };
}
