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
});
