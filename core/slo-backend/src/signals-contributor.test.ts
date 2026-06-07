import { describe, expect, test } from "bun:test";
import type { AuthUser } from "@checkstack/backend-api";
import type { SloObjective, SloStatus } from "@checkstack/slo-common";
import { createSloSignalsRead } from "./signals-contributor";
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
function makeServiceEngine({
  objectives,
}: {
  objectives: SloObjective[];
}): { service: SloService; engine: SloEngine } {
  const service = {
    listObjectives: async () => objectives,
  } as unknown as SloService;
  const engine = {
    computeStatus: async () => breachingStatus,
  } as unknown as SloEngine;
  return { service, engine };
}

const userWithAccess: AuthUser = {
  type: "user",
  id: "u1",
  accessRules: ["slo.slo.read"],
};

const userWithoutAccess: AuthUser = {
  type: "user",
  id: "u2",
  accessRules: [],
};

const serviceUser: AuthUser = { type: "service", pluginId: "other" };

describe("createSloSignalsRead", () => {
  test("returns {} when the principal lacks SLO read access (never throws)", async () => {
    const { service, engine } = makeServiceEngine({ objectives: [objective] });
    const read = createSloSignalsRead({ service, engine });

    const result = await read({ principal: userWithoutAccess });

    expect(result).toEqual({ accessible: false, signals: {} });
  });

  test("derives signals globally for an allowed user principal", async () => {
    const { service, engine } = makeServiceEngine({ objectives: [objective] });
    const read = createSloSignalsRead({ service, engine });

    const result = await read({ principal: userWithAccess });

    expect(result.signals["sys-a"]).toHaveLength(1);
    expect(result.signals["sys-a"]?.[0]?.tone).toBe("error");
    expect(result.signals["sys-a"]?.[0]?.label).toBe("SLO breaching");
    expect(result.signals["sys-a"]?.[0]?.source).toBe("slo");
  });

  test("treats a service principal as trusted (no access gate)", async () => {
    const { service, engine } = makeServiceEngine({ objectives: [objective] });
    const read = createSloSignalsRead({ service, engine });

    const result = await read({ principal: serviceUser });

    expect(result.signals["sys-a"]).toHaveLength(1);
  });
});
