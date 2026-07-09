import { describe, expect, test } from "bun:test";
import type { AuthUser } from "@checkstack/backend-api";
import type { SystemAccessResolver } from "@checkstack/ai-backend";
import type { SloObjective, SloStatus } from "@checkstack/slo-common";
import { createSloSignalsContributor } from "./signals-contributor";
import type { SloService } from "./service";
import type { SloEngine } from "./slo-engine";

const objective: SloObjective = {
  id: "obj-1",
  systemId: "sys-a",
  healthCheckConfigurationId: null,
  target: 99.9,
  windowDays: 30,
  dependencyExclusion: "strict",
  excludedDependencyIds: [],
  excludeMaintenanceWindows: false,
  burnRateThresholds: {
    warningPercent: 50,
    criticalPercent: 80,
    fastBurnMultiplier: 5,
  },
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

const breachingStatus: SloStatus = {
  objectiveId: "obj-1",
  systemId: "sys-a",
  target: 99.9,
  windowDays: 30,
  healthCheckConfigurationId: null,
  healthCheckConfigurationName: null,
  currentAvailability: 90,
  strictAvailability: 90,
  errorBudgetTotalMinutes: 100,
  errorBudgetConsumedMinutes: 110,
  errorBudgetConsumedStrictMinutes: 110,
  errorBudgetRemainingMinutes: -10,
  errorBudgetRemainingPercent: -10,
  burnRate: 5,
  dependencyExclusion: "strict",
  isBreaching: true,
  hasOpenDowntime: true,
  attribution: [],
};

// Minimal stubs: the contributor only calls listObjectives + computeStatus.
// Cast through unknown because the real classes carry many other members the
// contributor never touches in this unit.
function makeServiceEngine(): { service: SloService; engine: SloEngine } {
  const service = {
    listObjectives: async () => [objective],
  } as unknown as SloService;
  const engine = {
    computeStatus: async () => breachingStatus,
  } as unknown as SloEngine;
  return { service, engine };
}

// The per-source gate is owned/tested by createGatedSystemSignalsContributor.
const allowAll: SystemAccessResolver = {
  accessibleSystemIds: async ({ systemIds }) => systemIds,
};
const denyAll: SystemAccessResolver = { accessibleSystemIds: async () => [] };
const userWith = (accessRules: string[]): AuthUser => ({
  type: "user",
  id: "u1",
  accessRules,
});

describe("createSloSignalsContributor", () => {
  test("uses the shared slo source id", () => {
    const { service, engine } = makeServiceEngine();
    const contributor = createSloSignalsContributor({
      service,
      engine,
      resolver: allowAll,
    });
    expect(contributor.sourceId).toBe("slo");
  });

  test("derives signals globally for an authorized principal", async () => {
    const { service, engine } = makeServiceEngine();
    const contributor = createSloSignalsContributor({
      service,
      engine,
      resolver: allowAll,
    });

    const result = await contributor.read({
      principal: userWith(["slo.slo.read"]),
    });

    expect(result.signals["sys-a"]).toHaveLength(1);
    expect(result.signals["sys-a"]?.[0]?.tone).toBe("error");
    expect(result.signals["sys-a"]?.[0]?.label).toBe("SLO breaching");
    expect(result.signals["sys-a"]?.[0]?.source).toBe("slo");
  });

  test("routes a non-global user through the team gate (no grants -> nothing)", async () => {
    const { service, engine } = makeServiceEngine();
    const contributor = createSloSignalsContributor({
      service,
      engine,
      resolver: denyAll,
    });

    const result = await contributor.read({ principal: userWith([]) });

    expect(result).toEqual({ accessible: false, signals: {} });
  });
});
