import { describe, it, expect } from "bun:test";
import type {
  HealthCheckStatus,
  NotificationPolicy,
} from "@checkstack/healthcheck-common";
import {
  classifyTransition,
  shouldNotifyTransition,
  type TransitionKind,
} from "./notification-policy";

const STATES: HealthCheckStatus[] = ["healthy", "degraded", "unhealthy"];

describe("classifyTransition", () => {
  // Build the full 3×3 transition matrix so future severity edits stay
  // honest. Every cell here doubles as documentation.
  const matrix: Record<
    HealthCheckStatus,
    Record<HealthCheckStatus, TransitionKind>
  > = {
    healthy: {
      healthy: "none",
      degraded: "escalation",
      unhealthy: "escalation",
    },
    degraded: {
      healthy: "recovery",
      degraded: "none",
      unhealthy: "escalation",
    },
    unhealthy: {
      healthy: "recovery",
      degraded: "deescalation",
      unhealthy: "none",
    },
  };

  for (const prev of STATES) {
    for (const next of STATES) {
      it(`${prev} → ${next} = ${matrix[prev][next]}`, () => {
        expect(classifyTransition(prev, next)).toBe(matrix[prev][next]);
      });
    }
  }
});

describe("shouldNotifyTransition", () => {
  // The helper only reads `suppressDeEscalations`; narrow the fixture
  // type so the test doesn't need to keep up with unrelated policy
  // fields added over time.
  const off: Pick<NotificationPolicy, "suppressDeEscalations"> = {
    suppressDeEscalations: false,
  };
  const on: Pick<NotificationPolicy, "suppressDeEscalations"> = {
    suppressDeEscalations: true,
  };

  it("never notifies on `none` (no actual change)", () => {
    expect(shouldNotifyTransition("none", off)).toBe(false);
    expect(shouldNotifyTransition("none", on)).toBe(false);
  });

  it("always notifies on escalations regardless of policy", () => {
    expect(shouldNotifyTransition("escalation", off)).toBe(true);
    expect(shouldNotifyTransition("escalation", on)).toBe(true);
  });

  it("always notifies on recoveries regardless of policy", () => {
    expect(shouldNotifyTransition("recovery", off)).toBe(true);
    expect(shouldNotifyTransition("recovery", on)).toBe(true);
  });

  it("notifies on de-escalations by default", () => {
    expect(shouldNotifyTransition("deescalation", off)).toBe(true);
  });

  it("suppresses de-escalations when the policy opts in", () => {
    expect(shouldNotifyTransition("deescalation", on)).toBe(false);
  });
});

describe("flapping scenario from the bug report", () => {
  // healthy → degraded → unhealthy → degraded → healthy
  //
  // With suppression on, the intermediate `unhealthy → degraded`
  // notification (the one operators called out as spammy) must be
  // skipped, while escalation and recovery still fire.
  const policy: Pick<NotificationPolicy, "suppressDeEscalations"> = {
    suppressDeEscalations: true,
  };
  const sequence: [HealthCheckStatus, HealthCheckStatus, boolean][] = [
    ["healthy", "degraded", true], // escalation
    ["degraded", "unhealthy", true], // escalation
    ["unhealthy", "degraded", false], // de-escalation — suppressed
    ["degraded", "healthy", true], // recovery
  ];

  for (const [prev, next, expected] of sequence) {
    it(`${prev} → ${next} should notify: ${expected}`, () => {
      const kind = classifyTransition(prev, next);
      expect(shouldNotifyTransition(kind, policy)).toBe(expected);
    });
  }
});
