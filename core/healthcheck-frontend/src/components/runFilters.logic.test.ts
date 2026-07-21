import { describe, expect, test } from "bun:test";
import {
  EMPTY_TABLE_FILTERS,
  parseTableFilters,
  serializeTableFilters,
  type DataTableFilterState,
} from "@checkstack/ui";
import {
  RUN_FACET_ID,
  runFacetIds,
  runSourceControl,
  runSourceFilterInput,
  runStatusControl,
  runStatusFilterInput,
  selectedRunStatus,
} from "./runFilters.logic";

const withFacets = (facets: Record<string, string>): DataTableFilterState => ({
  ...EMPTY_TABLE_FILTERS,
  facets,
});

const satellites = [
  { id: "sat-eu", name: "EU West" },
  { id: "sat-us", name: "US East" },
];

describe("runStatusControl", () => {
  test("offers the two coarse buckets as pills", () => {
    expect(runStatusControl.kind).toBe("pills");
    expect(runStatusControl.options.map((option) => option.value)).toEqual([
      "healthy",
      "failing",
    ]);
  });

  test("carries no row accessor (the server applies it)", () => {
    expect(runStatusControl).not.toHaveProperty("value");
  });
});

describe("runStatusFilterInput", () => {
  test("failing collapses degraded AND unhealthy", () => {
    // The whole point of the bucket: an operator hunting a problem wants
    // "anything not green", not the degraded/unhealthy distinction.
    expect(runStatusFilterInput({ filters: withFacets({ status: "failing" }) }))
      .toEqual(["degraded", "unhealthy"]);
  });

  test("healthy asks for healthy runs only", () => {
    expect(
      runStatusFilterInput({ filters: withFacets({ status: "healthy" }) }),
    ).toEqual(["healthy"]);
  });

  test("no selection leaves the query unconstrained, not empty", () => {
    // An empty array would be sent as "match none" and show nothing.
    expect(runStatusFilterInput({ filters: EMPTY_TABLE_FILTERS })).toBeUndefined();
  });

  test("an unknown value from a stale link reads as unconstrained", () => {
    expect(
      runStatusFilterInput({ filters: withFacets({ status: "flapping" }) }),
    ).toBeUndefined();
    expect(
      selectedRunStatus({ filters: withFacets({ status: "flapping" }) }),
    ).toBeUndefined();
  });
});

describe("runSourceControl", () => {
  test("leads with Local, then one option per satellite", () => {
    expect(runSourceControl({ satellites }).options).toEqual([
      { value: "local", label: "Local" },
      { value: "sat-eu", label: "EU West" },
      { value: "sat-us", label: "US East" },
    ]);
  });

  test("degrades to Local alone with no satellites registered", () => {
    expect(
      runSourceControl({ satellites: [] }).options.map((o) => o.value),
    ).toEqual(["local"]);
  });
});

describe("runSourceFilterInput", () => {
  test("passes the core and satellite selections straight through", () => {
    expect(
      runSourceFilterInput({ filters: withFacets({ source: "local" }) }),
    ).toBe("local");
    expect(
      runSourceFilterInput({ filters: withFacets({ source: "sat-eu" }) }),
    ).toBe("sat-eu");
  });

  test("no selection means every source", () => {
    expect(runSourceFilterInput({ filters: EMPTY_TABLE_FILTERS })).toBeUndefined();
  });
});

describe("URL round-trip", () => {
  test("a filtered run view survives serialise -> parse", () => {
    const state: DataTableFilterState = {
      query: "",
      facets: { [RUN_FACET_ID.status]: "failing", [RUN_FACET_ID.source]: "sat-eu" },
    };
    const params = new URLSearchParams(
      Object.entries(
        serializeTableFilters({ state, facetIds: runFacetIds }),
      ).filter(([, value]) => value.length > 0),
    );
    const parsed = parseTableFilters({ params, facetIds: runFacetIds });
    expect(runStatusFilterInput({ filters: parsed })).toEqual([
      "degraded",
      "unhealthy",
    ]);
    expect(runSourceFilterInput({ filters: parsed })).toBe("sat-eu");
  });
});
