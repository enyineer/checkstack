import { describe, expect, test } from "bun:test";
import {
  deriveSloSignals,
  SLO_AT_RISK_BUDGET_PERCENT,
  SLO_SIGNAL_SOURCE_ID,
  type SloSignalRow,
} from "./signals";
import type { SloObjective, SloStatus } from "./schemas";

const baseObjective: SloObjective = {
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

const baseStatus: SloStatus = {
  objectiveId: "obj-1",
  systemId: "sys-a",
  target: 99.9,
  windowDays: 30,
  healthCheckConfigurationId: null,
  healthCheckConfigurationName: null,
  currentAvailability: 100,
  strictAvailability: 100,
  errorBudgetTotalMinutes: 100,
  errorBudgetConsumedMinutes: 0,
  errorBudgetConsumedStrictMinutes: 0,
  errorBudgetRemainingMinutes: 100,
  errorBudgetRemainingPercent: 100,
  burnRate: 0,
  dependencyExclusion: "strict",
  isBreaching: false,
  hasOpenDowntime: false,
  attribution: [],
};

function row({
  objective,
  status,
}: {
  objective?: Partial<SloObjective>;
  status?: Partial<SloStatus>;
}): SloSignalRow {
  return {
    objective: { ...baseObjective, ...objective },
    status: { ...baseStatus, ...status },
  };
}

describe("deriveSloSignals", () => {
  test("emits an error signal for a breaching objective", () => {
    const result = deriveSloSignals({
      rowsBySystemId: {
        "sys-a": [
          row({
            objective: { id: "obj-1", target: 99.9, windowDays: 30 },
            status: { isBreaching: true, errorBudgetRemainingPercent: -5 },
          }),
        ],
      },
    });

    expect(result["sys-a"]).toEqual([
      {
        source: SLO_SIGNAL_SOURCE_ID,
        tone: "error",
        label: "SLO breaching",
        detail: "99.9% target over 30d",
        href: "/slo/obj-1",
        accessRule: expect.objectContaining({ id: "slo.read" }),
        iconName: "Target",
      },
    ]);
  });

  test("emits a warn signal for an objective with open downtime (degraded)", () => {
    const result = deriveSloSignals({
      rowsBySystemId: {
        "sys-a": [
          row({
            status: { hasOpenDowntime: true, errorBudgetRemainingPercent: 80 },
          }),
        ],
      },
    });

    expect(result["sys-a"]?.[0]?.tone).toBe("warn");
    expect(result["sys-a"]?.[0]?.label).toBe("SLO degraded");
  });

  test("emits a warn signal when the budget is at or below the at-risk threshold", () => {
    const result = deriveSloSignals({
      rowsBySystemId: {
        "sys-a": [
          row({
            status: {
              errorBudgetRemainingPercent: SLO_AT_RISK_BUDGET_PERCENT,
            },
          }),
        ],
      },
    });

    expect(result["sys-a"]?.[0]?.tone).toBe("warn");
    expect(result["sys-a"]?.[0]?.label).toBe("SLO at risk");
  });

  test("breaching takes precedence over open downtime and at-risk budget", () => {
    const result = deriveSloSignals({
      rowsBySystemId: {
        "sys-a": [
          row({
            status: {
              isBreaching: true,
              hasOpenDowntime: true,
              errorBudgetRemainingPercent: 5,
            },
          }),
        ],
      },
    });

    expect(result["sys-a"]?.[0]?.label).toBe("SLO breaching");
  });

  test("omits healthy objectives and systems with no problems", () => {
    const result = deriveSloSignals({
      rowsBySystemId: {
        "sys-a": [row({ status: { errorBudgetRemainingPercent: 95 } })],
        "sys-b": [],
      },
    });

    expect(result).toEqual({});
  });

  test("keeps only problem objectives within a mixed system", () => {
    const result = deriveSloSignals({
      rowsBySystemId: {
        "sys-a": [
          row({
            objective: { id: "healthy" },
            status: { errorBudgetRemainingPercent: 90 },
          }),
          row({
            objective: { id: "breaching" },
            status: { isBreaching: true },
          }),
        ],
      },
    });

    expect(result["sys-a"]).toHaveLength(1);
    expect(result["sys-a"]?.[0]?.label).toBe("SLO breaching");
    expect(result["sys-a"]?.[0]?.href).toBe("/slo/breaching");
  });
});
