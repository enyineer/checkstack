import { describe, expect, test } from "bun:test";
import type { HealthCheckConfiguration } from "@checkstack/healthcheck-common";
import {
  DEFAULT_HEALTHCHECK_LIST_STATE,
  HEALTHCHECK_LIST_PARAM,
  filterAndSortHealthChecks,
  hasActiveHealthCheckFilter,
  parseHealthCheckListState,
  serializeHealthCheckListState,
} from "./healthCheckListState.logic";

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

function makeParams(
  entries: Record<string, string>,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(entries)) params.set(k, v);
  return params;
}

describe("parseHealthCheckListState", () => {
  test("empty params yield defaults", () => {
    expect(parseHealthCheckListState(new URLSearchParams())).toEqual(
      DEFAULT_HEALTHCHECK_LIST_STATE,
    );
  });

  test("parses all params", () => {
    const params = makeParams({
      [HEALTHCHECK_LIST_PARAM.query]: "api",
      [HEALTHCHECK_LIST_PARAM.strategy]: "http",
      [HEALTHCHECK_LIST_PARAM.status]: "paused",
      [HEALTHCHECK_LIST_PARAM.system]: "sys-1",
    });
    expect(parseHealthCheckListState(params)).toEqual({
      query: "api",
      strategyId: "http",
      status: "paused",
      systemId: "sys-1",
    });
  });

  test("empty strategy/system strings resolve to null", () => {
    const params = makeParams({
      [HEALTHCHECK_LIST_PARAM.strategy]: "",
      [HEALTHCHECK_LIST_PARAM.system]: "",
    });
    const state = parseHealthCheckListState(params);
    expect(state.strategyId).toBeNull();
    expect(state.systemId).toBeNull();
  });

  test("invalid status falls back to all", () => {
    const params = makeParams({ [HEALTHCHECK_LIST_PARAM.status]: "bogus" });
    expect(parseHealthCheckListState(params).status).toBe("all");
  });
});

describe("serializeHealthCheckListState", () => {
  test("default state serializes to all-empty (clean URL)", () => {
    const serialized = serializeHealthCheckListState(
      DEFAULT_HEALTHCHECK_LIST_STATE,
    );
    for (const value of Object.values(serialized)) {
      expect(value).toBe("");
    }
  });

  test("round-trips a populated state", () => {
    const state = {
      query: "api",
      strategyId: "http",
      status: "paused" as const,
      systemId: "sys-1",
    };
    const serialized = serializeHealthCheckListState(state);
    expect(
      parseHealthCheckListState(makeParams(serialized)),
    ).toEqual(state);
  });

  test("default status serializes to empty (omitted from URL)", () => {
    const serialized = serializeHealthCheckListState({
      query: "",
      strategyId: null,
      status: "all",
      systemId: null,
    });
    expect(serialized[HEALTHCHECK_LIST_PARAM.status]).toBe("");
  });
});

describe("filterAndSortHealthChecks", () => {
  const configs = [
    makeConfig({ id: "c1", name: "Beta check", strategyId: "http", paused: false }),
    makeConfig({ id: "c2", name: "alpha check", strategyId: "tcp", paused: true }),
    makeConfig({ id: "c3", name: "Gamma probe", strategyId: "http", paused: false }),
  ];

  test("sorts by name case-insensitively", () => {
    const result = filterAndSortHealthChecks({
      configurations: configs,
      state: DEFAULT_HEALTHCHECK_LIST_STATE,
    });
    expect(result.map((c) => c.name)).toEqual([
      "alpha check",
      "Beta check",
      "Gamma probe",
    ]);
  });

  test("query filters by name substring (case-insensitive)", () => {
    const result = filterAndSortHealthChecks({
      configurations: configs,
      state: { ...DEFAULT_HEALTHCHECK_LIST_STATE, query: "BET" },
    });
    expect(result.map((c) => c.id)).toEqual(["c1"]);
  });

  test("strategy filter narrows to a single strategy", () => {
    const result = filterAndSortHealthChecks({
      configurations: configs,
      state: { ...DEFAULT_HEALTHCHECK_LIST_STATE, strategyId: "http" },
    });
    expect(result.map((c) => c.id).sort()).toEqual(["c1", "c3"]);
  });

  test("status=active returns only non-paused", () => {
    const result = filterAndSortHealthChecks({
      configurations: configs,
      state: { ...DEFAULT_HEALTHCHECK_LIST_STATE, status: "active" },
    });
    expect(result.map((c) => c.paused)).toEqual([false, false]);
  });

  test("status=paused returns only paused", () => {
    const result = filterAndSortHealthChecks({
      configurations: configs,
      state: { ...DEFAULT_HEALTHCHECK_LIST_STATE, status: "paused" },
    });
    expect(result.map((c) => c.id)).toEqual(["c2"]);
  });

  test("system filter intersects with assigned config ids", () => {
    const result = filterAndSortHealthChecks({
      configurations: configs,
      state: {
        ...DEFAULT_HEALTHCHECK_LIST_STATE,
        systemId: "sys-1",
      },
      assignedConfigIds: new Set(["c2", "c3"]),
    });
    expect(result.map((c) => c.id).sort()).toEqual(["c2", "c3"]);
  });

  test("system filter shows nothing while assigned ids are loading (undefined)", () => {
    const result = filterAndSortHealthChecks({
      configurations: configs,
      state: {
        ...DEFAULT_HEALTHCHECK_LIST_STATE,
        systemId: "sys-1",
      },
      assignedConfigIds: undefined,
    });
    expect(result).toEqual([]);
  });

  test("system filter with empty assigned set shows nothing", () => {
    const result = filterAndSortHealthChecks({
      configurations: configs,
      state: {
        ...DEFAULT_HEALTHCHECK_LIST_STATE,
        systemId: "sys-1",
      },
      assignedConfigIds: new Set<string>(),
    });
    expect(result).toEqual([]);
  });

  test("filters compose (AND): query + strategy + status + system", () => {
    const result = filterAndSortHealthChecks({
      configurations: configs,
      state: {
        query: "gam",
        strategyId: "http",
        status: "active",
        systemId: "sys-1",
      },
      assignedConfigIds: new Set(["c1", "c3"]),
    });
    expect(result.map((c) => c.id)).toEqual(["c3"]);
  });

  test("empty query string does not filter", () => {
    const result = filterAndSortHealthChecks({
      configurations: configs,
      state: { ...DEFAULT_HEALTHCHECK_LIST_STATE, query: "" },
    });
    expect(result).toHaveLength(3);
  });
});

describe("hasActiveHealthCheckFilter", () => {
  test("default state has no active filter", () => {
    expect(hasActiveHealthCheckFilter(DEFAULT_HEALTHCHECK_LIST_STATE)).toBe(
      false,
    );
  });

  test("query alone is an active filter", () => {
    expect(
      hasActiveHealthCheckFilter({
        ...DEFAULT_HEALTHCHECK_LIST_STATE,
        query: "x",
      }),
    ).toBe(true);
  });

  test("whitespace-only query is not an active filter", () => {
    expect(
      hasActiveHealthCheckFilter({
        ...DEFAULT_HEALTHCHECK_LIST_STATE,
        query: "   ",
      }),
    ).toBe(false);
  });

  test("any single dimension counts as active", () => {
    expect(
      hasActiveHealthCheckFilter({
        ...DEFAULT_HEALTHCHECK_LIST_STATE,
        strategyId: "http",
      }),
    ).toBe(true);
    expect(
      hasActiveHealthCheckFilter({
        ...DEFAULT_HEALTHCHECK_LIST_STATE,
        status: "paused",
      }),
    ).toBe(true);
    expect(
      hasActiveHealthCheckFilter({
        ...DEFAULT_HEALTHCHECK_LIST_STATE,
        systemId: "sys-1",
      }),
    ).toBe(true);
  });
});
