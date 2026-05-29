import { describe, it, expect } from "bun:test";
import type {
  HealthCheckStatus,
  NotificationPolicy,
} from "@checkstack/healthcheck-common";
import {
  isTransitionToUnhealthy,
  shouldOpenForFlapping,
  shouldOpenForSustainedUnhealthy,
} from "./auto-incident";

const ALL_STATES: HealthCheckStatus[] = ["healthy", "degraded", "unhealthy"];

function policy(overrides: Partial<NotificationPolicy> = {}): NotificationPolicy {
  return {
    suppressDeEscalations: false,
    autoOpenIncidentOnUnhealthy: true,
    useNotificationSuppression: true,
    skipDuringMaintenance: true,
    sustainedUnhealthyTrigger: { enabled: true, durationMinutes: 30 },
    flappingTrigger: { enabled: true, transitions: 3, windowMinutes: 60 },
    autoCloseAfterMinutes: 30,
    ...overrides,
  };
}

describe("isTransitionToUnhealthy", () => {
  it("returns true on healthy → unhealthy", () => {
    expect(isTransitionToUnhealthy("healthy", "unhealthy")).toBe(true);
  });

  it("returns true on degraded → unhealthy", () => {
    expect(isTransitionToUnhealthy("degraded", "unhealthy")).toBe(true);
  });

  it("returns true on undefined → unhealthy (first-ever evaluation)", () => {
    expect(isTransitionToUnhealthy(undefined, "unhealthy")).toBe(true);
  });

  it("returns false when staying unhealthy", () => {
    expect(isTransitionToUnhealthy("unhealthy", "unhealthy")).toBe(false);
  });

  for (const next of ALL_STATES) {
    if (next === "unhealthy") continue;
    it(`returns false when transitioning to ${next}`, () => {
      for (const prev of [...ALL_STATES, undefined]) {
        expect(isTransitionToUnhealthy(prev, next)).toBe(false);
      }
    });
  }
});

describe("shouldOpenForFlapping", () => {
  it("never opens when auto-open is disabled at the top level", () => {
    const p = policy({ autoOpenIncidentOnUnhealthy: false });
    expect(
      shouldOpenForFlapping({ policy: p, recentTransitionCount: 999 }),
    ).toBe(false);
  });

  it("never opens when the flapping trigger itself is disabled", () => {
    const p = policy({
      flappingTrigger: { enabled: false, transitions: 1, windowMinutes: 60 },
    });
    expect(
      shouldOpenForFlapping({ policy: p, recentTransitionCount: 999 }),
    ).toBe(false);
  });

  it("does not open below the configured transition count", () => {
    const p = policy(); // default transitions: 3
    expect(
      shouldOpenForFlapping({ policy: p, recentTransitionCount: 1 }),
    ).toBe(false);
    expect(
      shouldOpenForFlapping({ policy: p, recentTransitionCount: 2 }),
    ).toBe(false);
  });

  it("opens once the count reaches the threshold", () => {
    const p = policy();
    expect(
      shouldOpenForFlapping({ policy: p, recentTransitionCount: 3 }),
    ).toBe(true);
  });

  it("stays open above the threshold (no upper bound)", () => {
    const p = policy();
    expect(
      shouldOpenForFlapping({ policy: p, recentTransitionCount: 99 }),
    ).toBe(true);
  });
});

describe("shouldOpenForSustainedUnhealthy", () => {
  it("never opens when auto-open is disabled at the top level", () => {
    const p = policy({ autoOpenIncidentOnUnhealthy: false });
    expect(
      shouldOpenForSustainedUnhealthy({
        policy: p,
        unhealthyForMs: 10 * 60 * 60_000,
      }),
    ).toBe(false);
  });

  it("never opens when the sustained trigger itself is disabled", () => {
    const p = policy({
      sustainedUnhealthyTrigger: { enabled: false, durationMinutes: 30 },
    });
    expect(
      shouldOpenForSustainedUnhealthy({
        policy: p,
        unhealthyForMs: 10 * 60 * 60_000,
      }),
    ).toBe(false);
  });

  it("does not open below the configured duration", () => {
    // 29 minutes < 30 minute threshold
    expect(
      shouldOpenForSustainedUnhealthy({
        policy: policy(),
        unhealthyForMs: 29 * 60_000,
      }),
    ).toBe(false);
  });

  it("opens exactly at the threshold", () => {
    expect(
      shouldOpenForSustainedUnhealthy({
        policy: policy(),
        unhealthyForMs: 30 * 60_000,
      }),
    ).toBe(true);
  });

  it("opens beyond the threshold", () => {
    expect(
      shouldOpenForSustainedUnhealthy({
        policy: policy(),
        unhealthyForMs: 60 * 60_000,
      }),
    ).toBe(true);
  });

  it("respects a custom duration", () => {
    const p = policy({
      sustainedUnhealthyTrigger: { enabled: true, durationMinutes: 5 },
    });
    expect(
      shouldOpenForSustainedUnhealthy({
        policy: p,
        unhealthyForMs: 4 * 60_000,
      }),
    ).toBe(false);
    expect(
      shouldOpenForSustainedUnhealthy({
        policy: p,
        unhealthyForMs: 5 * 60_000,
      }),
    ).toBe(true);
  });
});

describe("flapping vs sustained", () => {
  // The two triggers cover different failure modes. Both should fire
  // on their respective inputs; either is sufficient to open.
  it("flapping fires on persistent flapping where each phase is brief", () => {
    // Check has flapped 3 times in the last hour but each unhealthy
    // phase was only 5 min long (so sustained would never fire).
    expect(
      shouldOpenForFlapping({ policy: policy(), recentTransitionCount: 3 }),
    ).toBe(true);
    expect(
      shouldOpenForSustainedUnhealthy({
        policy: policy(),
        unhealthyForMs: 5 * 60_000,
      }),
    ).toBe(false);
  });

  it("sustained fires on a real outage that hasn't flapped yet", () => {
    // Only 1 transition (the original break), but it has been
    // unhealthy for 45 minutes straight.
    expect(
      shouldOpenForFlapping({ policy: policy(), recentTransitionCount: 1 }),
    ).toBe(false);
    expect(
      shouldOpenForSustainedUnhealthy({
        policy: policy(),
        unhealthyForMs: 45 * 60_000,
      }),
    ).toBe(true);
  });
});
