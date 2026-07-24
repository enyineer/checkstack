import { describe, expect, test } from "bun:test";
import {
  ANY_FACET_VALUE,
  EMPTY_TABLE_FILTERS,
  TABLE_QUERY_PARAM,
  type DataTableFilterState,
} from "@checkstack/ui";
import {
  parseViewState,
  serializeViewState,
  parseOpenParam,
  serializeOpenParam,
  toCatalogFilters,
  hasCatalogFilters,
  catalogFacetIds,
  DEFAULT_VIEW_STATE,
  NO_CATALOG_FILTERS,
  BROWSE_PARAM,
} from "./browseState.logic";

/** Build a `params.get`-style reader from a plain record. */
function reader(record: Record<string, string>) {
  return { get: (key: string): string | null => record[key] ?? null };
}

/** A shared filter state with the given facet selections. */
function filterState(
  overrides: Partial<DataTableFilterState> = {},
): DataTableFilterState {
  return { ...EMPTY_TABLE_FILTERS, ...overrides };
}

describe("URL parameter contract", () => {
  test("the facet ids ARE the browse view's param names", () => {
    // A facet id doubles as its URL parameter, so this equality is what keeps
    // already-shared browse links working after the migration to the shared bar.
    expect([...catalogFacetIds]).toEqual([
      BROWSE_PARAM.group,
      BROWSE_PARAM.health,
      BROWSE_PARAM.tag,
    ]);
  });

  test("the search param matches the shared hook's own", () => {
    expect(BROWSE_PARAM.query).toBe(TABLE_QUERY_PARAM);
  });
});

describe("toCatalogFilters", () => {
  test("unconstrained facets read as null", () => {
    expect(toCatalogFilters(EMPTY_TABLE_FILTERS)).toEqual(NO_CATALOG_FILTERS);
  });

  test("reads query, group, health and tag", () => {
    expect(
      toCatalogFilters(
        filterState({
          query: "checkout",
          facets: {
            [BROWSE_PARAM.group]: "payments",
            [BROWSE_PARAM.health]: "degraded",
            [BROWSE_PARAM.tag]: "team=payments",
          },
        }),
      ),
    ).toEqual({
      query: "checkout",
      group: "payments",
      health: "degraded",
      tag: "team=payments",
    });
  });

  test("an unparseable health value degrades to unconstrained", () => {
    // A hand-edited or stale link must widen the list, never filter on a status
    // no system can ever report.
    expect(
      toCatalogFilters(
        filterState({ facets: { [BROWSE_PARAM.health]: "bogus" } }),
      ).health,
    ).toBeNull();
  });

  test("the shared sentinel is not a health value", () => {
    expect(
      toCatalogFilters(
        filterState({ facets: { [BROWSE_PARAM.health]: ANY_FACET_VALUE } }),
      ).health,
    ).toBeNull();
  });
});

describe("hasCatalogFilters", () => {
  test("nothing selected is not filtered", () => {
    expect(hasCatalogFilters(NO_CATALOG_FILTERS)).toBe(false);
    expect(hasCatalogFilters({ ...NO_CATALOG_FILTERS, query: "   " })).toBe(
      false,
    );
  });

  test("any one dimension counts", () => {
    expect(hasCatalogFilters({ ...NO_CATALOG_FILTERS, query: "api" })).toBe(true);
    expect(hasCatalogFilters({ ...NO_CATALOG_FILTERS, group: "g1" })).toBe(true);
    expect(hasCatalogFilters({ ...NO_CATALOG_FILTERS, health: "degraded" })).toBe(
      true,
    );
    expect(hasCatalogFilters({ ...NO_CATALOG_FILTERS, tag: "tier=1" })).toBe(
      true,
    );
  });
});

describe("parseViewState", () => {
  test("returns defaults for empty params", () => {
    expect(parseViewState(reader({}))).toEqual(DEFAULT_VIEW_STATE);
  });

  test("parses density and open sections", () => {
    expect(
      parseViewState(
        reader({
          [BROWSE_PARAM.density]: "compact",
          [BROWSE_PARAM.open]: "payments,-platform",
        }),
      ),
    ).toEqual({
      density: "compact",
      open: { payments: true, platform: false },
    });
  });

  test("falls back to the default for an invalid density", () => {
    expect(
      parseViewState(reader({ [BROWSE_PARAM.density]: "huge" })).density,
    ).toBe("comfortable");
  });
});

describe("open param round-trip", () => {
  test("parseOpenParam handles forced-open and forced-closed", () => {
    expect(parseOpenParam("a,-b,c")).toEqual({ a: true, b: false, c: true });
  });

  test("parseOpenParam ignores blank/empty tokens", () => {
    expect(parseOpenParam(" , ,-")).toEqual({});
    expect(parseOpenParam(null)).toEqual({});
    expect(parseOpenParam("")).toEqual({});
  });

  test("serializeOpenParam is sorted and deterministic", () => {
    expect(serializeOpenParam({ c: true, a: false, b: true })).toBe("-a,b,c");
  });

  test("open map survives a full round-trip", () => {
    const open = { payments: true, platform: false, infra: true };
    expect(parseOpenParam(serializeOpenParam(open))).toEqual(open);
  });
});

describe("serializeViewState", () => {
  test("default state produces all-empty (no params)", () => {
    expect(serializeViewState(DEFAULT_VIEW_STATE)).toEqual({
      [BROWSE_PARAM.density]: "",
      [BROWSE_PARAM.open]: "",
    });
  });

  test("non-default values are emitted", () => {
    const out = serializeViewState({ density: "compact", open: { g1: true } });
    expect(out[BROWSE_PARAM.density]).toBe("compact");
    expect(out[BROWSE_PARAM.open]).toBe("g1");
  });

  test("parse(serialize(state)) round-trips a non-default view", () => {
    const view = {
      density: "compact" as const,
      open: { payments: true, platform: false },
    };
    const serialized = serializeViewState(view);
    const filled = Object.fromEntries(
      Object.entries(serialized).filter(([, v]) => v.length > 0),
    );
    expect(parseViewState(reader(filled))).toEqual(view);
  });
});
