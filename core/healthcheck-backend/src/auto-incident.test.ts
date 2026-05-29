import { describe, it, expect } from "bun:test";
import type {
  HealthCheckStatus,
  NotificationPolicy,
} from "@checkstack/healthcheck-common";
import {
  isTransitionToUnhealthy,
  shouldOpenAutoIncident,
} from "./auto-incident";

const ALL_STATES: HealthCheckStatus[] = ["healthy", "degraded", "unhealthy"];

function policy(overrides: Partial<NotificationPolicy> = {}): NotificationPolicy {
  return {
    suppressDeEscalations: false,
    autoOpenIncidentOnUnhealthy: true,
    useNotificationSuppression: true,
    incidentThreshold: { transitions: 1, windowMinutes: 60 },
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

describe("shouldOpenAutoIncident", () => {
  it("never opens when the policy disables auto-open", () => {
    const p = policy({ autoOpenIncidentOnUnhealthy: false });
    expect(
      shouldOpenAutoIncident({ policy: p, recentTransitionCount: 999 }),
    ).toBe(false);
  });

  it("opens on the very first transition with default threshold (1)", () => {
    const p = policy();
    expect(
      shouldOpenAutoIncident({ policy: p, recentTransitionCount: 1 }),
    ).toBe(true);
  });

  it("does not open below the configured transition threshold", () => {
    const p = policy({
      incidentThreshold: { transitions: 3, windowMinutes: 60 },
    });
    expect(
      shouldOpenAutoIncident({ policy: p, recentTransitionCount: 1 }),
    ).toBe(false);
    expect(
      shouldOpenAutoIncident({ policy: p, recentTransitionCount: 2 }),
    ).toBe(false);
  });

  it("opens once the count reaches the threshold", () => {
    const p = policy({
      incidentThreshold: { transitions: 3, windowMinutes: 60 },
    });
    expect(
      shouldOpenAutoIncident({ policy: p, recentTransitionCount: 3 }),
    ).toBe(true);
  });

  it("stays open above the threshold (no upper bound)", () => {
    const p = policy({
      incidentThreshold: { transitions: 3, windowMinutes: 60 },
    });
    expect(
      shouldOpenAutoIncident({ policy: p, recentTransitionCount: 99 }),
    ).toBe(true);
  });
});
