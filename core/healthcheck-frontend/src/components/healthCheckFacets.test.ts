import { describe, expect, test } from "bun:test";
import {
  EMPTY_TABLE_FILTERS,
  parseTableFilters,
  serializeTableFilters,
  type DataTableFilterState,
} from "@checkstack/ui";
import {
  StrategyCategory,
  type HealthCheckConfiguration,
  type HealthCheckStrategyDto,
} from "@checkstack/healthcheck-common";
import {
  HEALTHCHECK_FACET_ID,
  filterHealthChecks,
  healthCheckClientFacets,
  healthCheckFacetIds,
  healthCheckFilterControls,
  healthCheckSystemControl,
  selectedSystemId,
} from "./healthCheckFacets";

/** Minimal factory for a HealthCheckConfiguration with sensible defaults. */
function makeConfig(
  overrides: Partial<HealthCheckConfiguration> = {},
): HealthCheckConfiguration {
  return {
    id: overrides.id ?? "c1",
    name: overrides.name ?? "API check",
    strategyId: overrides.strategyId ?? "http",
    config: overrides.config ?? {},
    intervalSeconds: overrides.intervalSeconds ?? 30,
    collectors: overrides.collectors,
    paused: overrides.paused ?? false,
    createdAt: overrides.createdAt ?? new Date("2024-01-01"),
    updatedAt: overrides.updatedAt ?? new Date("2024-01-02"),
  };
}

/** Minimal strategy DTO - only id + displayName reach the facet options. */
function makeStrategy(id: string, displayName: string): HealthCheckStrategyDto {
  return {
    id,
    displayName,
    category: StrategyCategory.NETWORKING,
    configSchema: {},
  };
}

const strategies = [makeStrategy("http", "HTTP"), makeStrategy("tcp", "TCP")];

const systems = [
  { id: "sys-1", name: "Payments" },
  { id: "sys-2", name: "Search" },
];

const configs = [
  makeConfig({ id: "c1", name: "Beta check", strategyId: "http" }),
  makeConfig({ id: "c2", name: "alpha check", strategyId: "tcp", paused: true }),
  makeConfig({ id: "c3", name: "Gamma probe", strategyId: "http" }),
];

const withFacets = (facets: Record<string, string>): DataTableFilterState => ({
  ...EMPTY_TABLE_FILTERS,
  facets,
});

const filterBy = (filters: DataTableFilterState) =>
  filterHealthChecks({ configurations: configs, filters, strategies }).map(
    (config) => config.id,
  );

describe("healthCheckFacets", () => {
  test("declares the strategy/status/system dimensions, in display order", () => {
    expect(healthCheckFacetIds).toEqual(["strategy", "status", "system"]);
    expect(
      healthCheckFilterControls({ strategies, systems }).map((c) => c.id),
    ).toEqual(["strategy", "status", "system"]);
  });

  test("facet ids are the URL parameter names the old toolbar used", () => {
    // Guards the shared links (and the catalog's per-system wayfinding link,
    // which hand-builds `?system=<id>`) against a silent rename.
    expect(HEALTHCHECK_FACET_ID).toEqual({
      strategy: "strategy",
      status: "status",
      system: "system",
    });
  });

  test("strategy options are derived from the strategy registry", () => {
    const strategy = healthCheckClientFacets({ strategies }).find(
      (facet) => facet.id === HEALTHCHECK_FACET_ID.strategy,
    );
    expect(strategy?.options).toEqual([
      { value: "http", label: "HTTP" },
      { value: "tcp", label: "TCP" },
    ]);
  });

  test("the system control carries no row accessor (it is applied server-side)", () => {
    // A configuration has no system field - the selection swaps the data
    // source instead - so the control must not pretend to match a row.
    expect(healthCheckSystemControl({ systems })).not.toHaveProperty("value");
    expect(healthCheckSystemControl({ systems }).options).toEqual([
      { value: "sys-1", label: "Payments" },
      { value: "sys-2", label: "Search" },
    ]);
  });

  test("search matches the configuration name, case-insensitively", () => {
    expect(
      filterBy({ ...EMPTY_TABLE_FILTERS, query: "BET" }),
    ).toEqual(["c1"]);
  });

  test("strategy narrows to a single strategy", () => {
    expect(filterBy(withFacets({ strategy: "http" }))).toEqual(["c1", "c3"]);
  });

  test("status maps to the derived paused flag", () => {
    expect(filterBy(withFacets({ status: "active" }))).toEqual(["c1", "c3"]);
    expect(filterBy(withFacets({ status: "paused" }))).toEqual(["c2"]);
  });

  test("facets and search are ANDed", () => {
    expect(
      filterBy({ query: "gam", facets: { strategy: "http", status: "active" } }),
    ).toEqual(["c3"]);
  });

  test("the system selection never narrows client-side", () => {
    // The rows arrive already scoped by `getSystemConfigurations`; applying the
    // selection again against a field no row has would empty the list.
    expect(filterBy(withFacets({ system: "sys-1" }))).toEqual([
      "c1",
      "c2",
      "c3",
    ]);
  });

  test("an unfiltered state returns the rows untouched", () => {
    expect(filterBy(EMPTY_TABLE_FILTERS)).toEqual(["c1", "c2", "c3"]);
  });
});

describe("selectedSystemId", () => {
  test("reads the selected system", () => {
    expect(selectedSystemId({ filters: withFacets({ system: "sys-1" }) })).toBe(
      "sys-1",
    );
  });

  test("is undefined when unconstrained", () => {
    expect(selectedSystemId({ filters: EMPTY_TABLE_FILTERS })).toBeUndefined();
  });

  test("an empty value from a hand-edited link reads as unconstrained", () => {
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
