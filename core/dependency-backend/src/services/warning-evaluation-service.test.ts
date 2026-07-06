import { describe, expect, it } from "bun:test";
import type { Dependency } from "@checkstack/dependency-common";
import {
  WarningEvaluationService,
  type SystemStatus,
} from "./warning-evaluation-service";

const service = new WarningEvaluationService();

/** Build a dependency edge A(source) depends on B(target). */
function edge(
  overrides: Partial<Dependency> & {
    healthCheckRules?: Dependency["healthCheckRules"];
  } = {},
): Dependency {
  return {
    id: "dep-1",
    sourceSystemId: "A",
    targetSystemId: "B",
    impactType: "critical",
    transitive: false,
    label: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

/** Build one scope cell. */
function cell(
  overrides: Partial<NonNullable<Dependency["healthCheckRules"]>[number]> = {},
): NonNullable<Dependency["healthCheckRules"]>[number] {
  return {
    id: "cell-1",
    dependencyId: "dep-1",
    healthCheckId: null,
    environmentId: null,
    overrideImpactType: "critical",
    ...overrides,
  };
}

/** Evaluate A's warning given B's status. */
function evalA(dep: Dependency, statusB: SystemStatus) {
  return service.evaluateSystem({
    systemId: "A",
    allDependencies: [dep],
    systemStatuses: new Map([
      ["A", { systemId: "A", systemName: "A", status: "operational" }],
      ["B", statusB],
    ]),
    visited: new Set(),
  });
}

const B = (over: Partial<SystemStatus> = {}): SystemStatus => ({
  systemId: "B",
  systemName: "B",
  status: "operational",
  ...over,
});

describe("default behaviour (no scope cells)", () => {
  it("no warning when the target is operational", () => {
    expect(evalA(edge(), B())).toBeUndefined();
  });

  it("critical edge → down when target is down", () => {
    const w = evalA(edge({ impactType: "critical" }), B({ status: "down" }));
    expect(w?.derivedState).toBe("down");
  });

  it("critical edge → degraded when target only degraded", () => {
    const w = evalA(edge({ impactType: "critical" }), B({ status: "degraded" }));
    expect(w?.derivedState).toBe("degraded");
  });

  it("degraded edge → degraded even when target is down", () => {
    const w = evalA(edge({ impactType: "degraded" }), B({ status: "down" }));
    expect(w?.derivedState).toBe("degraded");
  });

  it("informational edge → info", () => {
    const w = evalA(edge({ impactType: "informational" }), B({ status: "down" }));
    expect(w?.derivedState).toBe("info");
  });
});

describe("check-only cells (env = any)", () => {
  it("fires for a specific target check across environments", () => {
    const dep = edge({
      healthCheckRules: [cell({ healthCheckId: "cfgA", overrideImpactType: "critical" })],
    });
    const w = evalA(
      dep,
      B({
        status: "operational", // overall rollup healthy...
        healthCheckStatuses: [{ healthCheckId: "cfgA", status: "unhealthy" }],
      }),
    );
    expect(w?.derivedState).toBe("down");
  });

  it("ignores other checks", () => {
    const dep = edge({
      healthCheckRules: [cell({ healthCheckId: "cfgA" })],
    });
    const w = evalA(
      dep,
      B({ healthCheckStatuses: [{ healthCheckId: "cfgB", status: "unhealthy" }] }),
    );
    expect(w).toBeUndefined();
  });
});

describe("environment-only cells (check = any)", () => {
  it("fires from a per-environment outage the overall rollup hides", () => {
    const dep = edge({
      healthCheckRules: [cell({ environmentId: "prod", overrideImpactType: "critical" })],
    });
    const w = evalA(
      dep,
      B({
        status: "operational", // rollup hides the prod outage
        environments: { prod: { status: "down" }, staging: { status: "operational" } },
      }),
    );
    expect(w?.derivedState).toBe("down");
  });

  it("does not fire when a different environment is down", () => {
    const dep = edge({
      healthCheckRules: [cell({ environmentId: "prod" })],
    });
    const w = evalA(
      dep,
      B({ environments: { staging: { status: "down" } } }),
    );
    expect(w).toBeUndefined();
  });

  it("treats a missing environment slice as non-contributing", () => {
    const dep = edge({
      healthCheckRules: [cell({ environmentId: "prod" })],
    });
    const w = evalA(dep, B({ status: "down", environments: {} }));
    expect(w).toBeUndefined();
  });
});

describe("check + environment cells (full matrix)", () => {
  it("fires only for the specific check in the specific environment", () => {
    const dep = edge({
      healthCheckRules: [
        cell({ healthCheckId: "cfgA", environmentId: "prod", overrideImpactType: "degraded" }),
      ],
    });
    const w = evalA(
      dep,
      B({
        status: "operational",
        environments: {
          prod: {
            status: "down",
            healthCheckStatuses: [{ healthCheckId: "cfgA", status: "unhealthy" }],
          },
        },
      }),
    );
    // Cell severity is `degraded`, so even a down check maps to degraded.
    expect(w?.derivedState).toBe("degraded");
  });

  it("does not fire when the pinned check is healthy in that env", () => {
    const dep = edge({
      healthCheckRules: [cell({ healthCheckId: "cfgA", environmentId: "prod" })],
    });
    const w = evalA(
      dep,
      B({
        environments: {
          prod: {
            status: "down",
            healthCheckStatuses: [
              { healthCheckId: "cfgA", status: "healthy" },
              { healthCheckId: "cfgB", status: "unhealthy" },
            ],
          },
        },
      }),
    );
    expect(w).toBeUndefined();
  });
});

describe("multiple cells (worst-wins, per-cell severity)", () => {
  it("takes the worst derived state across cells", () => {
    const dep = edge({
      healthCheckRules: [
        cell({ id: "c1", environmentId: "staging", overrideImpactType: "degraded" }),
        cell({ id: "c2", environmentId: "prod", overrideImpactType: "critical" }),
      ],
    });
    const w = evalA(
      dep,
      B({
        environments: {
          staging: { status: "degraded" },
          prod: { status: "down" },
        },
      }),
    );
    expect(w?.derivedState).toBe("down");
  });
});
