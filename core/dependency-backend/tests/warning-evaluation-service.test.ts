import { describe, test, expect } from "bun:test";
import { WarningEvaluationService } from "../src/services/warning-evaluation-service";
import type { SystemStatus } from "../src/services/warning-evaluation-service";
import type { Dependency } from "@checkstack/dependency-common";

function makeDependency(
  overrides: Partial<Dependency> & {
    sourceSystemId: string;
    targetSystemId: string;
  },
): Dependency {
  return {
    id: crypto.randomUUID(),
    impactType: "degraded",
    transitive: false,
    // eslint-disable-next-line unicorn/no-null -- Drizzle schema uses null
    label: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeSystemStatus(
  overrides: Partial<SystemStatus> & { systemId: string },
): SystemStatus {
  return {
    systemName: `System ${overrides.systemId}`,
    status: "operational",
    ...overrides,
  };
}

describe("WarningEvaluationService", () => {
  const service = new WarningEvaluationService();

  describe("evaluateWarnings", () => {
    test("returns empty map when no dependencies exist", () => {
      const result = service.evaluateWarnings({
        systemIds: ["sys-a"],
        allDependencies: [],
        systemStatuses: new Map([
          ["sys-a", makeSystemStatus({ systemId: "sys-a" })],
        ]),
      });

      expect(result.size).toBe(0);
    });

    test("returns no warning when upstream is operational", () => {
      const result = service.evaluateWarnings({
        systemIds: ["sys-a"],
        allDependencies: [
          makeDependency({
            sourceSystemId: "sys-a",
            targetSystemId: "sys-b",
            impactType: "critical",
          }),
        ],
        systemStatuses: new Map([
          ["sys-a", makeSystemStatus({ systemId: "sys-a" })],
          [
            "sys-b",
            makeSystemStatus({ systemId: "sys-b", status: "operational" }),
          ],
        ]),
      });

      expect(result.size).toBe(0);
    });

    test("returns degraded warning for degraded upstream with degraded impact", () => {
      const result = service.evaluateWarnings({
        systemIds: ["sys-a"],
        allDependencies: [
          makeDependency({
            sourceSystemId: "sys-a",
            targetSystemId: "sys-b",
            impactType: "degraded",
          }),
        ],
        systemStatuses: new Map([
          ["sys-a", makeSystemStatus({ systemId: "sys-a" })],
          [
            "sys-b",
            makeSystemStatus({ systemId: "sys-b", status: "degraded" }),
          ],
        ]),
      });

      expect(result.size).toBe(1);
      const warning = result.get("sys-a")!;
      expect(warning.derivedState).toBe("degraded");
      expect(warning.affectedUpstreams).toHaveLength(1);
      expect(warning.affectedUpstreams[0].systemId).toBe("sys-b");
    });

    test("returns degraded warning for degraded upstream with critical impact", () => {
      const result = service.evaluateWarnings({
        systemIds: ["sys-a"],
        allDependencies: [
          makeDependency({
            sourceSystemId: "sys-a",
            targetSystemId: "sys-b",
            impactType: "critical",
          }),
        ],
        systemStatuses: new Map([
          ["sys-a", makeSystemStatus({ systemId: "sys-a" })],
          [
            "sys-b",
            makeSystemStatus({ systemId: "sys-b", status: "degraded" }),
          ],
        ]),
      });

      const warning = result.get("sys-a")!;
      expect(warning.derivedState).toBe("degraded");
    });

    test("returns down warning for down upstream with critical impact", () => {
      const result = service.evaluateWarnings({
        systemIds: ["sys-a"],
        allDependencies: [
          makeDependency({
            sourceSystemId: "sys-a",
            targetSystemId: "sys-b",
            impactType: "critical",
          }),
        ],
        systemStatuses: new Map([
          ["sys-a", makeSystemStatus({ systemId: "sys-a" })],
          ["sys-b", makeSystemStatus({ systemId: "sys-b", status: "down" })],
        ]),
      });

      const warning = result.get("sys-a")!;
      expect(warning.derivedState).toBe("down");
    });

    test("returns info warning for informational impact type", () => {
      const result = service.evaluateWarnings({
        systemIds: ["sys-a"],
        allDependencies: [
          makeDependency({
            sourceSystemId: "sys-a",
            targetSystemId: "sys-b",
            impactType: "informational",
          }),
        ],
        systemStatuses: new Map([
          ["sys-a", makeSystemStatus({ systemId: "sys-a" })],
          ["sys-b", makeSystemStatus({ systemId: "sys-b", status: "down" })],
        ]),
      });

      const warning = result.get("sys-a")!;
      expect(warning.derivedState).toBe("info");
    });
  });

  describe("worst state aggregation", () => {
    test("selects the worst state across multiple upstream failures", () => {
      const result = service.evaluateWarnings({
        systemIds: ["sys-a"],
        allDependencies: [
          makeDependency({
            sourceSystemId: "sys-a",
            targetSystemId: "sys-b",
            impactType: "informational",
          }),
          makeDependency({
            sourceSystemId: "sys-a",
            targetSystemId: "sys-c",
            impactType: "critical",
          }),
        ],
        systemStatuses: new Map([
          ["sys-a", makeSystemStatus({ systemId: "sys-a" })],
          ["sys-b", makeSystemStatus({ systemId: "sys-b", status: "down" })],
          [
            "sys-c",
            makeSystemStatus({ systemId: "sys-c", status: "degraded" }),
          ],
        ]),
      });

      const warning = result.get("sys-a")!;
      // info from sys-b (informational + down = info)
      // degraded from sys-c (critical + degraded = degraded)
      // worst: degraded
      expect(warning.derivedState).toBe("degraded");
      expect(warning.affectedUpstreams).toHaveLength(2);
    });
  });

  describe("transitive propagation", () => {
    test("propagates warnings through transitive dependency chains", () => {
      // sys-a depends on sys-b (transitive), sys-b depends on sys-c
      // sys-c is down, but sys-b is still operational
      // With transitive: sys-a should see degradation through sys-b
      const result = service.evaluateWarnings({
        systemIds: ["sys-a"],
        allDependencies: [
          makeDependency({
            sourceSystemId: "sys-a",
            targetSystemId: "sys-b",
            impactType: "critical",
            transitive: true,
          }),
          makeDependency({
            sourceSystemId: "sys-b",
            targetSystemId: "sys-c",
            impactType: "critical",
          }),
        ],
        systemStatuses: new Map([
          ["sys-a", makeSystemStatus({ systemId: "sys-a" })],
          [
            "sys-b",
            makeSystemStatus({
              systemId: "sys-b",
              status: "operational",
            }),
          ],
          ["sys-c", makeSystemStatus({ systemId: "sys-c", status: "down" })],
        ]),
      });

      const warning = result.get("sys-a")!;
      expect(warning).toBeDefined();
      // sys-b is promoted to "down" from sys-c's critical+down
      // then sys-a gets critical+down = "down"
      expect(warning.derivedState).toBe("down");
    });

    test("does not propagate through non-transitive dependencies", () => {
      // Same chain but without transitive flag
      const result = service.evaluateWarnings({
        systemIds: ["sys-a"],
        allDependencies: [
          makeDependency({
            sourceSystemId: "sys-a",
            targetSystemId: "sys-b",
            impactType: "critical",
            transitive: false,
          }),
          makeDependency({
            sourceSystemId: "sys-b",
            targetSystemId: "sys-c",
            impactType: "critical",
          }),
        ],
        systemStatuses: new Map([
          ["sys-a", makeSystemStatus({ systemId: "sys-a" })],
          [
            "sys-b",
            makeSystemStatus({
              systemId: "sys-b",
              status: "operational",
            }),
          ],
          ["sys-c", makeSystemStatus({ systemId: "sys-c", status: "down" })],
        ]),
      });

      // sys-b is operational (not affected), sys-a has no warning
      expect(result.size).toBe(0);
    });
  });

  describe("cycle safety", () => {
    test("handles dependency cycles without infinite loops", () => {
      // sys-a → sys-b → sys-c → sys-a (cycle)
      const result = service.evaluateWarnings({
        systemIds: ["sys-a"],
        allDependencies: [
          makeDependency({
            sourceSystemId: "sys-a",
            targetSystemId: "sys-b",
            impactType: "critical",
            transitive: true,
          }),
          makeDependency({
            sourceSystemId: "sys-b",
            targetSystemId: "sys-c",
            impactType: "critical",
            transitive: true,
          }),
          makeDependency({
            sourceSystemId: "sys-c",
            targetSystemId: "sys-a",
            impactType: "critical",
            transitive: true,
          }),
        ],
        systemStatuses: new Map([
          [
            "sys-a",
            makeSystemStatus({ systemId: "sys-a", status: "operational" }),
          ],
          [
            "sys-b",
            makeSystemStatus({ systemId: "sys-b", status: "degraded" }),
          ],
          [
            "sys-c",
            makeSystemStatus({ systemId: "sys-c", status: "operational" }),
          ],
        ]),
      });

      // Should not hang or throw — visited guard protects against cycles
      expect(result).toBeDefined();
      // sys-a depends on sys-b (degraded) → sys-a gets degraded
      const warning = result.get("sys-a")!;
      expect(warning).toBeDefined();
      expect(warning.derivedState).toBe("degraded");
    });
  });

  describe("health check rules", () => {
    test("uses health check rules when available", () => {
      const result = service.evaluateWarnings({
        systemIds: ["sys-a"],
        allDependencies: [
          makeDependency({
            sourceSystemId: "sys-a",
            targetSystemId: "sys-b",
            impactType: "degraded", // base impact
            healthCheckRules: [
              {
                id: "rule-1",
                dependencyId: "dep-1",
                healthCheckId: "hc-1",
                environmentId: null, // any environment
                overrideImpactType: "critical", // overridden to critical for this check
              },
            ],
          }),
        ],
        systemStatuses: new Map([
          ["sys-a", makeSystemStatus({ systemId: "sys-a" })],
          [
            "sys-b",
            makeSystemStatus({
              systemId: "sys-b",
              status: "down",
              healthCheckStatuses: [
                { healthCheckId: "hc-1", status: "unhealthy" },
              ],
            }),
          ],
        ]),
      });

      const warning = result.get("sys-a")!;
      // hc-1 is unhealthy → maps to "down" upstream equivalent
      // With critical override: down → "down" derived state
      expect(warning.derivedState).toBe("down");
    });

    test("skips healthy health checks in rules", () => {
      const result = service.evaluateWarnings({
        systemIds: ["sys-a"],
        allDependencies: [
          makeDependency({
            sourceSystemId: "sys-a",
            targetSystemId: "sys-b",
            impactType: "critical",
            healthCheckRules: [
              {
                id: "rule-1",
                dependencyId: "dep-1",
                healthCheckId: "hc-1",
                environmentId: null, // any environment
                overrideImpactType: "critical",
              },
            ],
          }),
        ],
        systemStatuses: new Map([
          ["sys-a", makeSystemStatus({ systemId: "sys-a" })],
          [
            "sys-b",
            makeSystemStatus({
              systemId: "sys-b",
              status: "down", // overall status is down
              healthCheckStatuses: [
                { healthCheckId: "hc-1", status: "healthy" }, // but the specific check is healthy
              ],
            }),
          ],
        ]),
      });

      // No warning because the specific health check rule targets hc-1 which is healthy
      expect(result.size).toBe(0);
    });
  });

  describe("bulk evaluation", () => {
    test("evaluates multiple systems in a single call", () => {
      const result = service.evaluateWarnings({
        systemIds: ["sys-a", "sys-b", "sys-c"],
        allDependencies: [
          makeDependency({
            sourceSystemId: "sys-a",
            targetSystemId: "sys-d",
            impactType: "critical",
          }),
          makeDependency({
            sourceSystemId: "sys-b",
            targetSystemId: "sys-d",
            impactType: "degraded",
          }),
          // sys-c has no dependencies
        ],
        systemStatuses: new Map([
          ["sys-a", makeSystemStatus({ systemId: "sys-a" })],
          ["sys-b", makeSystemStatus({ systemId: "sys-b" })],
          ["sys-c", makeSystemStatus({ systemId: "sys-c" })],
          ["sys-d", makeSystemStatus({ systemId: "sys-d", status: "down" })],
        ]),
      });

      expect(result.size).toBe(2);
      expect(result.get("sys-a")!.derivedState).toBe("down");
      expect(result.get("sys-b")!.derivedState).toBe("degraded");
      expect(result.has("sys-c")).toBe(false);
    });
  });

  describe("mixed transitive/non-transitive edges", () => {
    // Topology: A --transitive--> B --non-transitive--> C (down)
    // B is operational but depends on C (non-transitively).
    // The non-transitive B→C edge means B only sees C's direct status.
    // Since A→B is transitive, A recursively evaluates B's deps.
    // B→C fires because C is down, promoting B's effective status.
    // A then sees B's promoted status and fires its own warning.
    test("transitive first hop + non-transitive second hop: propagation reaches through direct failures", () => {
      const result = service.evaluateWarnings({
        systemIds: ["sys-a"],
        allDependencies: [
          makeDependency({
            sourceSystemId: "sys-a",
            targetSystemId: "sys-b",
            impactType: "critical",
            transitive: true,
          }),
          makeDependency({
            sourceSystemId: "sys-b",
            targetSystemId: "sys-c",
            impactType: "critical",
            transitive: false,
          }),
        ],
        systemStatuses: new Map([
          ["sys-a", makeSystemStatus({ systemId: "sys-a" })],
          ["sys-b", makeSystemStatus({ systemId: "sys-b", status: "operational" })],
          ["sys-c", makeSystemStatus({ systemId: "sys-c", status: "down" })],
        ]),
      });

      // A→B is transitive, so A evaluates B's dependencies.
      // B→C (non-transitive) sees C is down, B gets promoted to "down".
      // A→B (critical + down) = down derived state.
      const warning = result.get("sys-a")!;
      expect(warning).toBeDefined();
      expect(warning.derivedState).toBe("down");
    });

    // Topology: A --non-transitive--> B --transitive--> C --critical--> D (down)
    // A→B is NOT transitive, so A only sees B's direct status.
    // B is operational, so no warning for A — even though B would
    // transitively derive a warning from C→D.
    test("non-transitive first hop blocks all deeper propagation", () => {
      const result = service.evaluateWarnings({
        systemIds: ["sys-a"],
        allDependencies: [
          makeDependency({
            sourceSystemId: "sys-a",
            targetSystemId: "sys-b",
            impactType: "critical",
            transitive: false,
          }),
          makeDependency({
            sourceSystemId: "sys-b",
            targetSystemId: "sys-c",
            impactType: "critical",
            transitive: true,
          }),
          makeDependency({
            sourceSystemId: "sys-c",
            targetSystemId: "sys-d",
            impactType: "critical",
          }),
        ],
        systemStatuses: new Map([
          ["sys-a", makeSystemStatus({ systemId: "sys-a" })],
          ["sys-b", makeSystemStatus({ systemId: "sys-b", status: "operational" })],
          ["sys-c", makeSystemStatus({ systemId: "sys-c", status: "operational" })],
          ["sys-d", makeSystemStatus({ systemId: "sys-d", status: "down" })],
        ]),
      });

      // A→B is non-transitive. B is operational (own status).
      // A does NOT look through B's dependencies. No warning.
      expect(result.size).toBe(0);
    });

    // Topology: A has two branches:
    //   A --transitive--> B (operational) --> C (down)
    //   A --non-transitive--> D (operational) --> E (down)
    // Expected: A gets a warning from the transitive B branch,
    //           but NOT from the non-transitive D branch.
    test("fan-out: transitive branch propagates, non-transitive branch does not", () => {
      const result = service.evaluateWarnings({
        systemIds: ["sys-a"],
        allDependencies: [
          // Transitive branch
          makeDependency({
            sourceSystemId: "sys-a",
            targetSystemId: "sys-b",
            impactType: "critical",
            transitive: true,
          }),
          makeDependency({
            sourceSystemId: "sys-b",
            targetSystemId: "sys-c",
            impactType: "critical",
          }),
          // Non-transitive branch
          makeDependency({
            sourceSystemId: "sys-a",
            targetSystemId: "sys-d",
            impactType: "critical",
            transitive: false,
          }),
          makeDependency({
            sourceSystemId: "sys-d",
            targetSystemId: "sys-e",
            impactType: "critical",
          }),
        ],
        systemStatuses: new Map([
          ["sys-a", makeSystemStatus({ systemId: "sys-a" })],
          ["sys-b", makeSystemStatus({ systemId: "sys-b", status: "operational" })],
          ["sys-c", makeSystemStatus({ systemId: "sys-c", status: "down" })],
          ["sys-d", makeSystemStatus({ systemId: "sys-d", status: "operational" })],
          ["sys-e", makeSystemStatus({ systemId: "sys-e", status: "down" })],
        ]),
      });

      const warning = result.get("sys-a")!;
      expect(warning).toBeDefined();
      expect(warning.derivedState).toBe("down");
      // Only the transitive branch contributes
      expect(warning.affectedUpstreams).toHaveLength(1);
      expect(warning.affectedUpstreams[0].systemId).toBe("sys-b");
    });

    // Topology: A --transitive--> B --transitive--> C --non-transitive--> D (operational) --> E (down)
    //           C is also down directly.
    // Expected: A sees through B and C (both transitive).
    //           C→D is non-transitive but C is down regardless.
    //           The chain A→B→C propagates C's "down" status all the way.
    test("deep chain: transitive-transitive-nontransitive propagates direct failures", () => {
      const result = service.evaluateWarnings({
        systemIds: ["sys-a"],
        allDependencies: [
          makeDependency({
            sourceSystemId: "sys-a",
            targetSystemId: "sys-b",
            impactType: "critical",
            transitive: true,
          }),
          makeDependency({
            sourceSystemId: "sys-b",
            targetSystemId: "sys-c",
            impactType: "critical",
            transitive: true,
          }),
          makeDependency({
            sourceSystemId: "sys-c",
            targetSystemId: "sys-d",
            impactType: "critical",
            transitive: false,
          }),
        ],
        systemStatuses: new Map([
          ["sys-a", makeSystemStatus({ systemId: "sys-a" })],
          ["sys-b", makeSystemStatus({ systemId: "sys-b", status: "operational" })],
          ["sys-c", makeSystemStatus({ systemId: "sys-c", status: "down" })],
          ["sys-d", makeSystemStatus({ systemId: "sys-d", status: "operational" })],
        ]),
      });

      const warning = result.get("sys-a")!;
      expect(warning).toBeDefined();
      // C is down → B promoted to down (transitive) → A gets critical+down = down
      expect(warning.derivedState).toBe("down");
    });

    // Same deep chain but upstream C is operational, failure is only at D.
    // C→D is non-transitive, so C doesn't look through D's deps.
    // But D is directly down and C's edge to D fires.
    // B→C is transitive so B evaluates C's deps.
    // C→D fires (D is down, non-transitive), promoting C to "down".
    // A→B is transitive, so A evaluates B's deps.
    // B→C fires with C promoted to "down". B promoted to "down".
    test("deep chain: non-transitive leaf edge still fires on direct failure", () => {
      const result = service.evaluateWarnings({
        systemIds: ["sys-a"],
        allDependencies: [
          makeDependency({
            sourceSystemId: "sys-a",
            targetSystemId: "sys-b",
            impactType: "critical",
            transitive: true,
          }),
          makeDependency({
            sourceSystemId: "sys-b",
            targetSystemId: "sys-c",
            impactType: "degraded",
            transitive: true,
          }),
          makeDependency({
            sourceSystemId: "sys-c",
            targetSystemId: "sys-d",
            impactType: "critical",
            transitive: false,
          }),
        ],
        systemStatuses: new Map([
          ["sys-a", makeSystemStatus({ systemId: "sys-a" })],
          ["sys-b", makeSystemStatus({ systemId: "sys-b", status: "operational" })],
          ["sys-c", makeSystemStatus({ systemId: "sys-c", status: "operational" })],
          ["sys-d", makeSystemStatus({ systemId: "sys-d", status: "down" })],
        ]),
      });

      const warning = result.get("sys-a")!;
      expect(warning).toBeDefined();
      // C→D: critical + down = down → C promoted to "down"
      // B→C: degraded + down(promoted) = degraded → B promoted to "degraded"
      // A→B: critical + degraded(promoted) = degraded
      expect(warning.derivedState).toBe("degraded");
    });

    // Topology: A has two branches with different impact types:
    //   A --transitive/informational--> B (operational) --> C (down)
    //   A --transitive/critical--------> D (operational) --> E (degraded)
    // Expected: worst-of-all branches applies.
    test("mixed impact fan-out: worst derived state wins across branches", () => {
      const result = service.evaluateWarnings({
        systemIds: ["sys-a"],
        allDependencies: [
          makeDependency({
            sourceSystemId: "sys-a",
            targetSystemId: "sys-b",
            impactType: "informational",
            transitive: true,
          }),
          makeDependency({
            sourceSystemId: "sys-b",
            targetSystemId: "sys-c",
            impactType: "critical",
          }),
          makeDependency({
            sourceSystemId: "sys-a",
            targetSystemId: "sys-d",
            impactType: "critical",
            transitive: true,
          }),
          makeDependency({
            sourceSystemId: "sys-d",
            targetSystemId: "sys-e",
            impactType: "critical",
          }),
        ],
        systemStatuses: new Map([
          ["sys-a", makeSystemStatus({ systemId: "sys-a" })],
          ["sys-b", makeSystemStatus({ systemId: "sys-b", status: "operational" })],
          ["sys-c", makeSystemStatus({ systemId: "sys-c", status: "down" })],
          ["sys-d", makeSystemStatus({ systemId: "sys-d", status: "operational" })],
          ["sys-e", makeSystemStatus({ systemId: "sys-e", status: "degraded" })],
        ]),
      });

      const warning = result.get("sys-a")!;
      expect(warning).toBeDefined();
      // Branch 1: B promoted to "down" from C, then A→B (informational+down) = info
      // Branch 2: D promoted to "degraded" from E, then A→D (critical+degraded) = degraded
      // Worst: degraded > info → degraded
      expect(warning.derivedState).toBe("degraded");
      expect(warning.affectedUpstreams).toHaveLength(2);
    });

    // All hops operational except last — non-transitive first hop should block everything.
    test("non-transitive first hop shields from deep transitive chain failure", () => {
      const result = service.evaluateWarnings({
        systemIds: ["sys-a"],
        allDependencies: [
          makeDependency({
            sourceSystemId: "sys-a",
            targetSystemId: "sys-b",
            impactType: "critical",
            transitive: false,
          }),
          makeDependency({
            sourceSystemId: "sys-b",
            targetSystemId: "sys-c",
            impactType: "critical",
            transitive: true,
          }),
          makeDependency({
            sourceSystemId: "sys-c",
            targetSystemId: "sys-d",
            impactType: "critical",
            transitive: true,
          }),
          makeDependency({
            sourceSystemId: "sys-d",
            targetSystemId: "sys-e",
            impactType: "critical",
            transitive: true,
          }),
        ],
        systemStatuses: new Map([
          ["sys-a", makeSystemStatus({ systemId: "sys-a" })],
          ["sys-b", makeSystemStatus({ systemId: "sys-b", status: "operational" })],
          ["sys-c", makeSystemStatus({ systemId: "sys-c", status: "operational" })],
          ["sys-d", makeSystemStatus({ systemId: "sys-d", status: "operational" })],
          ["sys-e", makeSystemStatus({ systemId: "sys-e", status: "down" })],
        ]),
      });

      // A→B is non-transitive. B is operational. A sees no failure.
      expect(result.size).toBe(0);
    });

    // Verify that the intermediate system B is correctly warned even when A is not.
    test("intermediate system gets warning even when downstream is shielded", () => {
      const result = service.evaluateWarnings({
        systemIds: ["sys-a", "sys-b"],
        allDependencies: [
          makeDependency({
            sourceSystemId: "sys-a",
            targetSystemId: "sys-b",
            impactType: "critical",
            transitive: false,
          }),
          makeDependency({
            sourceSystemId: "sys-b",
            targetSystemId: "sys-c",
            impactType: "critical",
            transitive: false,
          }),
        ],
        systemStatuses: new Map([
          ["sys-a", makeSystemStatus({ systemId: "sys-a" })],
          ["sys-b", makeSystemStatus({ systemId: "sys-b", status: "operational" })],
          ["sys-c", makeSystemStatus({ systemId: "sys-c", status: "down" })],
        ]),
      });

      // B→C fires (C is down). B gets warning "down".
      // A→B is non-transitive and B is operational (own status). A has no warning.
      expect(result.size).toBe(1);
      expect(result.has("sys-a")).toBe(false);
      expect(result.get("sys-b")!.derivedState).toBe("down");
    });
  });
});
