import { describe, expect, test } from "bun:test";
import {
  classifyBudgetConsumption,
  classifyBurnRate,
  classifySloStatus,
  classifyStreak,
  consumedBarWidthPercent,
  formatDowntimeDuration,
  presentSloStatus,
  remainingBudgetPercent,
} from "./sloDisplay.logic";

describe("classifyBurnRate", () => {
  test("null/undefined is unknown", () => {
    expect(classifyBurnRate({ burnRate: null })).toBe("unknown");
    expect(classifyBurnRate({ burnRate: undefined })).toBe("unknown");
  });

  test("below 1 is good", () => {
    expect(classifyBurnRate({ burnRate: 0 })).toBe("good");
    expect(classifyBurnRate({ burnRate: 0.99 })).toBe("good");
  });

  test("exactly 1 is on-pace (warn), not good", () => {
    expect(classifyBurnRate({ burnRate: 1 })).toBe("warn");
  });

  test("boundary 1.5 stays warn; just above is bad", () => {
    expect(classifyBurnRate({ burnRate: 1.5 })).toBe("warn");
    expect(classifyBurnRate({ burnRate: 1.51 })).toBe("bad");
  });
});

describe("classifyBudgetConsumption", () => {
  const thresholds = { warningThreshold: 50, criticalThreshold: 80 };

  test("below warning is ok", () => {
    expect(
      classifyBudgetConsumption({ consumedPercent: 49.9, ...thresholds }),
    ).toBe("ok");
  });

  test("at the warning threshold flips to warning", () => {
    expect(
      classifyBudgetConsumption({ consumedPercent: 50, ...thresholds }),
    ).toBe("warning");
  });

  test("at the critical threshold flips to critical", () => {
    expect(
      classifyBudgetConsumption({ consumedPercent: 80, ...thresholds }),
    ).toBe("critical");
  });

  test("critical wins when thresholds overlap", () => {
    expect(
      classifyBudgetConsumption({
        consumedPercent: 60,
        warningThreshold: 60,
        criticalThreshold: 60,
      }),
    ).toBe("critical");
  });
});

describe("classifySloStatus", () => {
  const healthy = {
    isBreaching: false,
    hasOpenDowntime: false,
    errorBudgetRemainingPercent: 100,
  };

  test("breaching wins over every other signal", () => {
    expect(
      classifySloStatus({
        isBreaching: true,
        hasOpenDowntime: true,
        errorBudgetRemainingPercent: 0,
      }),
    ).toBe("breaching");
  });

  test("open downtime is degraded when not breaching", () => {
    expect(
      classifySloStatus({ ...healthy, hasOpenDowntime: true }),
    ).toBe("degraded");
  });

  test("budget at/under 20% remaining is at-risk", () => {
    expect(
      classifySloStatus({ ...healthy, errorBudgetRemainingPercent: 20 }),
    ).toBe("at-risk");
    expect(
      classifySloStatus({ ...healthy, errorBudgetRemainingPercent: 19.9 }),
    ).toBe("at-risk");
  });

  test("budget above 20% remaining is healthy", () => {
    expect(
      classifySloStatus({ ...healthy, errorBudgetRemainingPercent: 20.1 }),
    ).toBe("healthy");
    expect(classifySloStatus(healthy)).toBe("healthy");
  });
});

describe("presentSloStatus", () => {
  test("maps each tier to its label + status-triad tone", () => {
    expect(presentSloStatus({ tier: "breaching" })).toEqual({
      label: "Breaching",
      tone: "down",
    });
    expect(presentSloStatus({ tier: "degraded" })).toEqual({
      label: "Degraded",
      tone: "warn",
    });
    expect(presentSloStatus({ tier: "at-risk" })).toEqual({
      label: "At risk",
      tone: "warn",
    });
    expect(presentSloStatus({ tier: "healthy" })).toEqual({
      label: "Healthy",
      tone: "ok",
    });
  });
});

describe("remainingBudgetPercent", () => {
  test("complement of consumed", () => {
    expect(remainingBudgetPercent({ consumedPercent: 30 })).toBe(70);
  });

  test("clamps over-consumption to zero", () => {
    expect(remainingBudgetPercent({ consumedPercent: 130 })).toBe(0);
  });
});

describe("consumedBarWidthPercent", () => {
  test("passes through in-range values", () => {
    expect(consumedBarWidthPercent({ consumedPercent: 42 })).toBe(42);
  });

  test("caps the width at 100", () => {
    expect(consumedBarWidthPercent({ consumedPercent: 250 })).toBe(100);
  });
});

describe("classifyStreak", () => {
  test("under 7 days is cold", () => {
    expect(classifyStreak({ currentStreak: 0 })).toBe("cold");
    expect(classifyStreak({ currentStreak: 6 })).toBe("cold");
  });

  test("inclusive boundaries at 7 / 30 / 90", () => {
    expect(classifyStreak({ currentStreak: 7 })).toBe("warm");
    expect(classifyStreak({ currentStreak: 29 })).toBe("warm");
    expect(classifyStreak({ currentStreak: 30 })).toBe("hot");
    expect(classifyStreak({ currentStreak: 89 })).toBe("hot");
    expect(classifyStreak({ currentStreak: 90 })).toBe("blazing");
  });
});

describe("formatDowntimeDuration", () => {
  test("missing or zero duration yields no label", () => {
    expect(formatDowntimeDuration({ durationSeconds: null })).toBeUndefined();
    expect(
      formatDowntimeDuration({ durationSeconds: undefined }),
    ).toBeUndefined();
    expect(formatDowntimeDuration({ durationSeconds: 0 })).toBeUndefined();
  });

  test("under an hour renders rounded minutes", () => {
    expect(formatDowntimeDuration({ durationSeconds: 90 })).toBe("2 min");
    expect(formatDowntimeDuration({ durationSeconds: 59 * 60 })).toBe("59 min");
  });

  test("an hour or more renders h/m", () => {
    expect(formatDowntimeDuration({ durationSeconds: 60 * 60 })).toBe("1h 0m");
    expect(formatDowntimeDuration({ durationSeconds: 90 * 60 })).toBe("1h 30m");
    expect(formatDowntimeDuration({ durationSeconds: 125 * 60 })).toBe("2h 5m");
  });
});
