/**
 * Pure, DOM-free logic behind {@link DataTable}'s search + facet filtering.
 *
 * Before this existed, every list surface hand-rolled the same thing: a search
 * box, a row of "narrow by X" selects, a clear affordance, and a filtered-empty
 * state. A survey of the repo found 18 surfaces doing it outside `DataTable`
 * against 17 using only its built-in search, with SIX different renderings of
 * the same control and THREE different "show everything" sentinels. This module
 * is the one contract they collapse onto.
 *
 * Split out from the component so the state transitions, the URL round-trip and
 * the matching rules are unit-testable without rendering a table.
 */

import { rowMatchesSearch } from "./helpers";
import type { StatusPillTone } from "../status-tone";

/**
 * The "no constraint" selection for a facet.
 *
 * Deliberately a reserved token rather than an empty string: Radix's `Select`
 * rejects `""` as an item value, which is why the surfaces that predated this
 * module each invented their own sentinel (`"any"`, `"__all__"`, `"all"`). It is
 * `"any"` and not `"all"` because `all` is a real domain value in at least one
 * facet already (an announcement visible to everyone), and a sentinel that
 * collides with a genuine option makes "show everything" indistinguishable from
 * "show only the public ones".
 */
export const ANY_FACET_VALUE = "any";

/** One selectable value of a facet. */
export interface DataTableFacetOption {
  value: string;
  label: string;
  /**
   * Semantic hue for this option when the facet renders as `pills`, drawn from
   * the shared status tones.
   *
   * Reserved for a dimension that genuinely IS a status: on a health surface,
   * green "Healthy" and red "Failing" are the product's vocabulary, and a
   * selected "Failing" that looks identical to a selected "Healthy" throws that
   * away. The hand-rolled pill group this replaced carried exactly this colour,
   * and a shared control that cannot express it is one a team forks again.
   *
   * Leave it unset everywhere else - a neutral selected state is correct for a
   * dimension like "enabled/disabled" or a run's trigger, and colouring those
   * would dilute the tones that mean something.
   */
  tone?: StatusPillTone;
}

/**
 * The PRESENTATIONAL half of a facet: everything {@link DataTableFilterBar}
 * needs to render the control, and nothing about how a row is matched.
 *
 * Split out from {@link DataTableFacet} because a surface can legitimately own
 * the control while the facet model cannot apply it. The catalog browse filters
 * are the case that forced the split: a system belongs to SEVERAL groups and
 * carries SEVERAL metadata tags, and its health lives in a separate status map
 * keyed by id - none of which a single `value(row): string` can express, and the
 * same three controls also filter GROUPS, a different row type entirely. Such a
 * surface still wants the one shared bar, so it passes controls and keeps its
 * own matching; a `DataTable` that filters its own rows passes the full
 * {@link DataTableFacet}, which is a control too.
 */
export interface DataTableFacetControl {
  /**
   * Stable id. Doubles as the URL parameter name, so keep it short and
   * URL-safe (`status`, `severity`, `visibility`).
   */
  id: string;
  /** Human label, e.g. `"Severity"`. Also drives the unconstrained option. */
  label: string;
  /** Selectable values, in display order. */
  options: readonly DataTableFacetOption[];
  /**
   * Render the control but refuse input - for a dimension that exists but whose
   * data source is not installed yet (the catalog's health filter before a
   * health source fills its slot).
   *
   * Preferred over dropping the facet from the array: a control that is visibly
   * present-but-unavailable, with a reason, tells the operator the capability
   * exists and what would unlock it, which an absent control cannot. Disabling
   * also keeps the facet's URL parameter declared, so a selection that arrives
   * on a shared link is preserved and still constrains rather than silently
   * widening the list.
   */
  disabled?: boolean;
  /** Tooltip explaining WHY the control is disabled. */
  disabledReason?: string;
  /**
   * Label for the unconstrained option. Defaults to `Any <label lowercased>`,
   * e.g. `"Any severity"`.
   */
  anyLabel?: string;
  /**
   * How to render the control.
   *
   * - `"select"` (default) - a dropdown. Right for anything past a handful of
   *   options, and the only sane choice on a narrow viewport.
   * - `"pills"` - a segmented row of buttons, every option visible and one
   *   click away. Right for two or three short options that a reader benefits
   *   from seeing at a glance (enabled/disabled, a run status). Use it
   *   sparingly: a dozen pills is a worse dropdown.
   *
   * Both variants share the same state, sentinel and URL round-trip, so the
   * choice is purely presentational.
   */
  kind?: "select" | "pills";
  /** Extra classes for the select trigger (typically a width). */
  triggerClassName?: string;
}

/**
 * A "narrow the rows by one dimension" control, plus the accessor that reads a
 * row's value for comparison - the form {@link applyTableFilters} (and so
 * `DataTable`) can apply on its own.
 */
export interface DataTableFacet<TData> extends DataTableFacetControl {
  /**
   * The row's value for this facet, compared against the selection. Return a
   * value that appears in `options`; a row whose value matches nothing on offer
   * is simply never shown while that facet is constrained.
   */
  value: (row: TData) => string;
}

/** The complete filter state of a table: free text plus a value per facet. */
export interface DataTableFilterState {
  /** Free-text search, matched against the columns' `searchValue`s. */
  query: string;
  /**
   * Selected value per facet id. A facet that is absent - or set to
   * {@link ANY_FACET_VALUE} - constrains nothing.
   */
  facets: Readonly<Record<string, string>>;
}

/** The unconstrained state: no query, every facet unset. */
export const EMPTY_TABLE_FILTERS: DataTableFilterState = {
  query: "",
  facets: {},
};

/** The selection for a facet, normalised to the sentinel when unset. */
export function selectedFacetValue(
  state: DataTableFilterState,
  facetId: string,
): string {
  return state.facets[facetId] ?? ANY_FACET_VALUE;
}

/** Is this selection an actual constraint (rather than "show everything")? */
export function isFacetConstrained(value: string | undefined): boolean {
  return value !== undefined && value !== ANY_FACET_VALUE && value.length > 0;
}

/**
 * Does anything currently narrow the list? Drives the Clear affordance and lets
 * a page tell "no rows match" apart from "there is nothing here yet".
 */
export function hasActiveTableFilters(state: DataTableFilterState): boolean {
  if (state.query.trim().length > 0) return true;
  return Object.values(state.facets).some((value) => isFacetConstrained(value));
}

/**
 * Set one facet's selection. Choosing the unconstrained sentinel REMOVES the
 * key rather than storing it, so an unconstrained state always deep-equals
 * {@link EMPTY_TABLE_FILTERS} and serialises to no URL parameter at all.
 */
export function withFacetValue(
  state: DataTableFilterState,
  facetId: string,
  value: string,
): DataTableFilterState {
  const facets = { ...state.facets };
  if (isFacetConstrained(value)) {
    facets[facetId] = value;
  } else {
    delete facets[facetId];
  }
  return { ...state, facets };
}

/** Set the free-text query. */
export function withQuery(
  state: DataTableFilterState,
  query: string,
): DataTableFilterState {
  return { ...state, query };
}

/**
 * Read a facet's selection back as a DOMAIN value, by parsing it against the
 * schema that defines it.
 *
 * Facet state is stringly-typed because it round-trips through the URL and
 * through `<Select>`, but a server-side filter needs the narrow union its query
 * input declares. Parsing rather than casting means a hand-edited or stale link
 * yields `undefined` - "unconstrained" - instead of smuggling an unknown value
 * into a request.
 *
 * ```ts
 * const status = parsedFacetValue({
 *   filters: filters.state,
 *   facetId: "status",
 *   schema: AutomationStatusSchema,
 * });
 * ```
 */
export function parsedFacetValue<TValue>({
  filters,
  facetId,
  schema,
}: {
  filters: DataTableFilterState;
  facetId: string;
  schema: { safeParse: (value: unknown) => { success: boolean; data?: TValue } };
}): TValue | undefined {
  const raw = filters.facets[facetId];
  if (!isFacetConstrained(raw)) return undefined;
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Apply the search and every constrained facet. Facets are ANDed with each
 * other and with the search.
 *
 * A `disabled` facet still applies: disabling stops the operator CHANGING the
 * selection, it does not silently widen one that arrived on a shared link.
 *
 * Returns the SAME array reference when nothing is constrained, so a table with
 * idle filters does not invalidate downstream memoisation on every render.
 */
export function applyTableFilters<TData>({
  rows,
  state,
  facets,
  searchAccessors,
}: {
  rows: TData[];
  state: DataTableFilterState;
  facets: ReadonlyArray<DataTableFacet<TData>>;
  searchAccessors: ReadonlyArray<(row: TData) => string>;
}): TData[] {
  const searchable = state.query.trim().length > 0 && searchAccessors.length > 0;
  const constrained = facets.filter((facet) =>
    isFacetConstrained(state.facets[facet.id]),
  );
  if (!searchable && constrained.length === 0) return rows;

  return rows.filter((row) => {
    if (
      searchable &&
      !rowMatchesSearch({ row, searchAccessors, query: state.query })
    ) {
      return false;
    }
    return constrained.every((facet) => facet.value(row) === state.facets[facet.id]);
  });
}

// ---------------------------------------------------------------------------
// URL round-trip
// ---------------------------------------------------------------------------

/** Parameter name for the free-text search. */
export const TABLE_QUERY_PARAM = "q";

/**
 * The URL parameter name for a facet (or the search). A `prefix` namespaces a
 * table's parameters so two filtered tables on one page cannot fight over `q`.
 */
export function filterParamKey({
  key,
  prefix,
}: {
  key: string;
  prefix?: string;
}): string {
  return prefix ? `${prefix}_${key}` : key;
}

/**
 * Read filter state out of the URL. Unknown facet ids and absent parameters are
 * ignored, so a hand-edited or stale link degrades to "less filtered" instead of
 * throwing or filtering on something the table cannot render a control for.
 */
export function parseTableFilters({
  params,
  facetIds,
  prefix,
}: {
  params: { get: (key: string) => string | null };
  facetIds: readonly string[];
  prefix?: string;
}): DataTableFilterState {
  const query = params.get(filterParamKey({ key: TABLE_QUERY_PARAM, prefix }));
  const facets: Record<string, string> = {};
  for (const id of facetIds) {
    const value = params.get(filterParamKey({ key: id, prefix }));
    if (isFacetConstrained(value ?? undefined)) {
      // Non-null by the guard above; `??` keeps the narrowing explicit.
      facets[id] = value ?? ANY_FACET_VALUE;
    }
  }
  return { query: query ?? "", facets };
}

/**
 * The parameter mutations for a filter state: key -> value, where an EMPTY
 * string means "remove this parameter". An unconstrained table therefore leaves
 * no parameters behind at all, so a default view has a clean URL.
 */
export function serializeTableFilters({
  state,
  facetIds,
  prefix,
}: {
  state: DataTableFilterState;
  facetIds: readonly string[];
  prefix?: string;
}): Record<string, string> {
  const out: Record<string, string> = {
    [filterParamKey({ key: TABLE_QUERY_PARAM, prefix })]: state.query,
  };
  for (const id of facetIds) {
    const value = state.facets[id];
    out[filterParamKey({ key: id, prefix })] = isFacetConstrained(value)
      ? // Constrained implies defined.
        (value ?? "")
      : "";
  }
  return out;
}
