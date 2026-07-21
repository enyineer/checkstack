import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  ANY_FACET_VALUE,
  EMPTY_TABLE_FILTERS,
  TABLE_QUERY_PARAM,
  applyTableFilters,
  filterParamKey,
  hasActiveTableFilters,
  isFacetConstrained,
  parsedFacetValue,
  parseTableFilters,
  selectedFacetValue,
  serializeTableFilters,
  withFacetValue,
  withQuery,
  type DataTableFacet,
  type DataTableFacetControl,
  type DataTableFilterState,
} from "./facets.logic";

interface Row {
  name: string;
  status: string;
  severity: string;
}

const rows: Row[] = [
  { name: "alpha", status: "active", severity: "critical" },
  { name: "beta", status: "expired", severity: "info" },
  { name: "gamma", status: "active", severity: "info" },
];

const facets: DataTableFacet<Row>[] = [
  {
    id: "status",
    label: "Status",
    options: [
      { value: "active", label: "Active" },
      { value: "expired", label: "Expired" },
    ],
    value: (row) => row.status,
  },
  {
    id: "severity",
    label: "Severity",
    options: [
      { value: "info", label: "Info" },
      { value: "critical", label: "Critical" },
    ],
    value: (row) => row.severity,
  },
];

const searchAccessors = [(row: Row) => row.name];

const state = (
  overrides: Partial<DataTableFilterState> = {},
): DataTableFilterState => ({ ...EMPTY_TABLE_FILTERS, ...overrides });

describe("selection helpers", () => {
  test("an unset facet reads as the unconstrained sentinel", () => {
    expect(selectedFacetValue(EMPTY_TABLE_FILTERS, "status")).toBe(
      ANY_FACET_VALUE,
    );
  });

  test("the sentinel and an empty string are not constraints", () => {
    expect(isFacetConstrained(ANY_FACET_VALUE)).toBe(false);
    expect(isFacetConstrained("")).toBe(false);
    expect(isFacetConstrained(undefined)).toBe(false);
    expect(isFacetConstrained("active")).toBe(true);
  });

  test("selecting the sentinel REMOVES the key, so the state stays canonical", () => {
    // Two states that constrain nothing must be indistinguishable, or a URL
    // would keep a `?status=any` that means the same as no parameter at all.
    const constrained = withFacetValue(EMPTY_TABLE_FILTERS, "status", "active");
    const cleared = withFacetValue(constrained, "status", ANY_FACET_VALUE);
    expect(cleared).toEqual(EMPTY_TABLE_FILTERS);
    expect(Object.keys(cleared.facets)).toHaveLength(0);
  });

  test("setting one facet leaves the others alone", () => {
    const next = withFacetValue(
      withFacetValue(EMPTY_TABLE_FILTERS, "status", "active"),
      "severity",
      "info",
    );
    expect(next.facets).toEqual({ status: "active", severity: "info" });
  });

  test("withQuery replaces only the query", () => {
    const next = withQuery(
      withFacetValue(EMPTY_TABLE_FILTERS, "status", "active"),
      "alpha",
    );
    expect(next).toEqual({ query: "alpha", facets: { status: "active" } });
  });
});

describe("parsedFacetValue", () => {
  const schema = z.enum(["enabled", "disabled"]);

  test("returns the domain value for a valid selection", () => {
    expect(
      parsedFacetValue({
        filters: state({ facets: { status: "enabled" } }),
        facetId: "status",
        schema,
      }),
    ).toBe("enabled");
  });

  test("an unset facet is undefined (unconstrained)", () => {
    expect(
      parsedFacetValue({
        filters: EMPTY_TABLE_FILTERS,
        facetId: "status",
        schema,
      }),
    ).toBeUndefined();
  });

  test("the sentinel is undefined, never passed through as a value", () => {
    expect(
      parsedFacetValue({
        filters: state({ facets: { status: ANY_FACET_VALUE } }),
        facetId: "status",
        schema,
      }),
    ).toBeUndefined();
  });

  test("a value the schema rejects degrades to unconstrained", () => {
    // A hand-edited or stale URL must not smuggle an unknown value into a
    // server query input.
    expect(
      parsedFacetValue({
        filters: state({ facets: { status: "haunted" } }),
        facetId: "status",
        schema,
      }),
    ).toBeUndefined();
  });
});

describe("hasActiveTableFilters", () => {
  test("the empty state is inactive", () => {
    expect(hasActiveTableFilters(EMPTY_TABLE_FILTERS)).toBe(false);
  });

  test("whitespace alone is not a filter", () => {
    expect(hasActiveTableFilters(state({ query: "   " }))).toBe(false);
  });

  test("a query or any constrained facet makes it active", () => {
    expect(hasActiveTableFilters(state({ query: "a" }))).toBe(true);
    expect(hasActiveTableFilters(state({ facets: { status: "active" } }))).toBe(
      true,
    );
  });

  test("a facet explicitly set to the sentinel is still inactive", () => {
    expect(
      hasActiveTableFilters(state({ facets: { status: ANY_FACET_VALUE } })),
    ).toBe(false);
  });
});

describe("applyTableFilters", () => {
  test("returns the SAME reference when nothing is constrained", () => {
    // Referential stability matters: an idle filter must not invalidate a
    // consumer's memo on every render.
    expect(
      applyTableFilters({
        rows,
        state: EMPTY_TABLE_FILTERS,
        facets,
        searchAccessors,
      }),
    ).toBe(rows);
  });

  test("a query with no searchable columns constrains nothing", () => {
    expect(
      applyTableFilters({
        rows,
        state: state({ query: "alpha" }),
        facets,
        searchAccessors: [],
      }),
    ).toBe(rows);
  });

  test("searches case-insensitively on a substring", () => {
    expect(
      applyTableFilters({
        rows,
        state: state({ query: "ALPH" }),
        facets,
        searchAccessors,
      }).map((r) => r.name),
    ).toEqual(["alpha"]);
  });

  test("filters by a facet", () => {
    expect(
      applyTableFilters({
        rows,
        state: state({ facets: { status: "active" } }),
        facets,
        searchAccessors,
      }).map((r) => r.name),
    ).toEqual(["alpha", "gamma"]);
  });

  test("ANDs facets with each other", () => {
    expect(
      applyTableFilters({
        rows,
        state: state({ facets: { status: "active", severity: "info" } }),
        facets,
        searchAccessors,
      }).map((r) => r.name),
    ).toEqual(["gamma"]);
  });

  test("ANDs the search with the facets", () => {
    expect(
      applyTableFilters({
        rows,
        state: state({ query: "alpha", facets: { severity: "info" } }),
        facets,
        searchAccessors,
      }),
    ).toEqual([]);
  });

  test("ignores a facet the table does not declare", () => {
    // A stale link naming a removed facet must degrade to "less filtered",
    // never to an empty table nobody can explain.
    expect(
      applyTableFilters({
        rows,
        state: state({ facets: { retired: "whatever" } }),
        facets,
        searchAccessors,
      }),
    ).toBe(rows);
  });

  test("preserves the caller's row order", () => {
    expect(
      applyTableFilters({
        rows,
        state: state({ facets: { severity: "info" } }),
        facets,
        searchAccessors,
      }).map((r) => r.name),
    ).toEqual(["beta", "gamma"]);
  });

  test("a disabled facet still constrains", () => {
    // Disabling stops the operator CHANGING the selection; it must not widen a
    // selection that arrived on a shared link, or a link to "the degraded
    // systems" would quietly reopen as "every system".
    const disabled: DataTableFacet<Row>[] = [
      { ...facets[0], disabled: true, disabledReason: "No data source" },
    ];
    expect(
      applyTableFilters({
        rows,
        state: state({ facets: { status: "expired" } }),
        facets: disabled,
        searchAccessors,
      }).map((r) => r.name),
    ).toEqual(["beta"]);
  });
});

describe("facet controls", () => {
  test("a full facet is usable wherever a control is expected", () => {
    // The split exists so a surface whose matching the facet model cannot
    // express (multi-valued, or across two row types) can still drive the
    // shared bar. A `DataTable`'s facets must keep working there unchanged.
    const asControls: DataTableFacetControl[] = facets;
    expect(asControls.map((facet) => facet.id)).toEqual(["status", "severity"]);
  });

  test("a control-only facet needs no row accessor", () => {
    const control: DataTableFacetControl = {
      id: "tag",
      label: "Tag",
      options: [{ value: "team=payments", label: "team=payments" }],
    };
    // Its selection still round-trips and still reads as constrained, which is
    // what the owning surface applies with its own matcher.
    expect(
      selectedFacetValue(state({ facets: { tag: "team=payments" } }), control.id),
    ).toBe("team=payments");
  });
});

describe("URL round-trip", () => {
  const facetIds = ["status", "severity"];
  const params = (entries: Record<string, string>) => new URLSearchParams(entries);

  test("parses query and facets", () => {
    expect(
      parseTableFilters({
        params: params({ q: "alpha", status: "active" }),
        facetIds,
      }),
    ).toEqual({ query: "alpha", facets: { status: "active" } });
  });

  test("absent parameters give the empty state", () => {
    expect(parseTableFilters({ params: params({}), facetIds })).toEqual(
      EMPTY_TABLE_FILTERS,
    );
  });

  test("a facet the table does not declare is dropped on parse", () => {
    expect(
      parseTableFilters({
        params: params({ status: "active", nonsense: "x" }),
        facetIds,
      }).facets,
    ).toEqual({ status: "active" });
  });

  test("an explicit sentinel in the URL parses as unconstrained", () => {
    expect(
      parseTableFilters({
        params: params({ status: ANY_FACET_VALUE }),
        facetIds,
      }),
    ).toEqual(EMPTY_TABLE_FILTERS);
  });

  test("the unconstrained state serialises to all-empty (a clean URL)", () => {
    // Empty string means "delete the parameter", so a default view carries no
    // query string at all.
    expect(
      serializeTableFilters({ state: EMPTY_TABLE_FILTERS, facetIds }),
    ).toEqual({ q: "", status: "", severity: "" });
  });

  test("round-trips a constrained state", () => {
    const original = state({ query: "alpha", facets: { severity: "info" } });
    const serialized = serializeTableFilters({ state: original, facetIds });
    expect(
      parseTableFilters({
        params: params(
          Object.fromEntries(
            Object.entries(serialized).filter(([, value]) => value.length > 0),
          ),
        ),
        facetIds,
      }),
    ).toEqual(original);
  });

  test("a prefix namespaces every parameter", () => {
    // Two filtered tables on one page must not fight over `q`.
    expect(filterParamKey({ key: TABLE_QUERY_PARAM, prefix: "runs" })).toBe(
      "runs_q",
    );
    expect(
      serializeTableFilters({
        state: state({ query: "x", facets: { status: "active" } }),
        facetIds,
        prefix: "runs",
      }),
    ).toEqual({ runs_q: "x", runs_status: "active", runs_severity: "" });
    expect(
      parseTableFilters({
        params: params({ runs_q: "x", q: "other" }),
        facetIds,
        prefix: "runs",
      }).query,
    ).toBe("x");
  });
});

describe("option tones", () => {
  test("a tone is optional metadata, never a matching input", () => {
    // Tone drives only how a selected pill looks. Two options that differ only
    // by tone must filter identically, or presentation would be silently
    // changing behaviour.
    const toned: DataTableFacet<Row> = {
      id: "status",
      label: "Status",
      kind: "pills",
      options: [
        { value: "active", label: "Active", tone: "ok" },
        { value: "expired", label: "Expired", tone: "down" },
      ],
      value: (row) => row.status,
    };
    expect(
      applyTableFilters({
        rows,
        state: state({ facets: { status: "active" } }),
        facets: [toned],
        searchAccessors,
      }).map((r) => r.name),
    ).toEqual(["alpha", "gamma"]);
  });
});
