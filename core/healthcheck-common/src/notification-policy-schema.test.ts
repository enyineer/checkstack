import { describe, it, expect } from "bun:test";
import {
  NotificationPolicySchema,
  DEFAULT_NOTIFICATION_POLICY,
} from "./schemas";

describe("NotificationPolicySchema", () => {
  it("accepts the slim policy shape", () => {
    const parsed = NotificationPolicySchema.parse({
      suppressDeEscalations: true,
    });
    expect(parsed).toEqual({ suppressDeEscalations: true });
  });

  it("defaults to the compile-time default when parsing an empty object", () => {
    const parsed = NotificationPolicySchema.parse({});
    expect(parsed).toEqual(DEFAULT_NOTIFICATION_POLICY);
    expect(parsed).toEqual({ suppressDeEscalations: false });
  });

  it("strips removed legacy keys (auto-incident AND flapping) without throwing", () => {
    // A row persisted before the legacy auto-incident fields and the
    // flapping thresholds were removed still carries the larger object.
    // zod's default object behaviour drops the unknown keys rather than
    // rejecting them — flapping now lives on the automation trigger config.
    const parsed = NotificationPolicySchema.parse({
      suppressDeEscalations: true,
      flappingTrigger: { enabled: false, transitions: 9, windowMinutes: 10 },
      autoOpenIncidentOnUnhealthy: true,
      useNotificationSuppression: true,
      skipDuringMaintenance: false,
      sustainedUnhealthyTrigger: { enabled: true, durationMinutes: 5 },
      autoCloseAfterMinutes: 99,
    });
    expect(parsed).toEqual({ suppressDeEscalations: true });
    expect(Object.keys(parsed)).toEqual(["suppressDeEscalations"]);
  });
});
