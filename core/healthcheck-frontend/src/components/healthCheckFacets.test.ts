import { describe, expect, test } from "bun:test";
import {
  ANY_FACET_VALUE,
  EMPTY_TABLE_FILTERS,
  parseTableFilters,
  serializeTableFilters,
  type DataTableFilterState,
} from "@checkstack/ui";
import type { HealthCheckStrategyDto } from "@checkstack/healthcheck-common";
import {
  HEALTHCHECK_FACET_ID,
  HEALTHCHECK_STATUS_OPTIONS,
  healthCheckFacetIds,
  healthCheckSystemControl,
  selectedSystemId,
  strategyFilterOptions,
} from "./healthCheckFacets";

/**
 * The MATCHING for search, strategy and status lives on the list's COLUMNS
 * (`filterValue`) and is applied by `DataTable`; `columnDerivedFacets` in
 * `@checkstack/ui` covers that machinery. What this module still owns - and what
 * these tests guard - is the option lists, the server-applied system control,
 * and the URL parameter names existing links depend on.
 */

const strategies = [
  { id: "http", displayName: "HTTP" },
  { id: "tcp", displayName: "TCP" },
] as HealthCheckStrategyDto[];

const systems = [
  { id: "sys-1", name: "Payments" },
  { id: "sys-2", name: "Search" },
];

const withFacets = (facets: Record<string, string>): DataTableFilterState => ({
  ...EMPTY_TABLE_FILTERS,
  facets,
});

describe("healthCheckFacets", () => {
  test("facet ids are the URL parameter names the old toolbar used", () => {
    // The catalog links here with `?system=<id>`; renaming any of these would
    // silently break links shared before the migration.
    expect(healthCheckFacetIds).toEqual(["strategy", "status", "system"]);
    expect(HEALTHCHECK_FACET_ID.system).toBe("system");
  });

  test("strategy options come from the registry, labelled for a reader", () => {
    // A row carries an opaque strategy id, so deriving the options from the
    // data would offer "http" / "tcp" rather than their display names.
    expect(strategyFilterOptions({ strategies })).toEqual([
      { value: "http", label: "HTTP" },
      { value: "tcp", label: "TCP" },
    ]);
  });

  test("a newly installed strategy appears without a second list to update", () => {
    expect(
      strategyFilterOptions({
        strategies: [
          ...strategies,
          { id: "grpc", displayName: "gRPC" } as HealthCheckStrategyDto,
        ],
      }).map((option) => option.value),
    ).toContain("grpc");
  });

  test("status offers active and paused", () => {
    expect(HEALTHCHECK_STATUS_OPTIONS.map((option) => option.value)).toEqual([
      "active",
      "paused",
    ]);
  });

  test("the system control carries no row accessor (it is applied server-side)", () => {
    // A configuration has no system field - the selection swaps the data source
    // instead - so the control must not pretend to match a row. `DataTable`
    // renders it but never applies it.
    expect(healthCheckSystemControl({ systems })).not.toHaveProperty("value");
    expect(healthCheckSystemControl({ systems }).options).toEqual([
      { value: "sys-1", label: "Payments" },
      { value: "sys-2", label: "Search" },
    ]);
  });
});

describe("selectedSystemId", () => {
  test("reads the selected system", () => {
    expect(selectedSystemId({ filters: withFacets({ system: "sys-1" }) })).toBe(
      "sys-1",
    );
  });

  test("unset and the sentinel both mean 'all systems'", () => {
    expect(selectedSystemId({ filters: EMPTY_TABLE_FILTERS })).toBeUndefined();
    expect(
      selectedSystemId({ filters: withFacets({ system: ANY_FACET_VALUE }) }),
    ).toBeUndefined();
  });

  test("an empty value from a hand-edited link reads as unconstrained", () => {
    // `?system=` would otherwise swap the data source to a lookup for the empty
    // system and return nothing, with no way to tell why.
    expect(selectedSystemId({ filters: withFacets({ system: "" }) })).toBe(
      undefined,
    );
  });
});

describe("URL round-trip", () => {
  test("a populated state survives serialise -> parse", () => {
    const state: DataTableFilterState = {
      query: "api",
      facets: { strategy: "http", status: "paused", system: "sys-1" },
    };
    const params = new URLSearchParams(
      Object.entries(
        serializeTableFilters({ state, facetIds: healthCheckFacetIds }),
      ).filter(([, value]) => value.length > 0),
    );
    expect(parseTableFilters({ params, facetIds: healthCheckFacetIds })).toEqual(
      state,
    );
  });

  test("a link that only carries ?system= reopens the system view", () => {
    // The shape the catalog's "Manage health checks" row action links to.
    const params = new URLSearchParams("system=sys-2");
    const filters = parseTableFilters({
      params,
      facetIds: healthCheckFacetIds,
    });
    expect(selectedSystemId({ filters })).toBe("sys-2");
  });
});
