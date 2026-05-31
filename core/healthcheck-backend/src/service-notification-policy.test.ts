import { describe, it, expect, mock } from "bun:test";
import { HealthCheckService } from "./service";
import { createMockDb } from "@checkstack/test-utils-backend";
import {
  DEFAULT_NOTIFICATION_POLICY,
  type NotificationPolicy,
} from "@checkstack/healthcheck-common";

/**
 * Build a service whose only DB interaction is the chain used by
 * `getAssignmentNotificationPolicy`. The chain ends in `.limit(1)` and
 * returns the supplied rows verbatim. An optional in-memory platform
 * default stands in for the ConfigService.
 */
function buildServiceWithRows(
  rows: unknown[],
  platformDefault?: NotificationPolicy,
): HealthCheckService {
  const mockDb = createMockDb();
  const limitChain = mock(async () => rows);
  const whereChain = mock(() => ({ limit: limitChain }));
  const fromChain = mock(() => ({ where: whereChain }));
  const selectChain = mock(() => ({ from: fromChain }));
  (mockDb as { select: unknown }).select = selectChain;

  const configService =
    platformDefault === undefined
      ? undefined
      : ({
          get: mock(async () => platformDefault),
          set: mock(async () => {}),
        } as never);

  return new HealthCheckService(
    mockDb as never,
    {} as never,
    {} as never,
    configService,
  );
}

describe("HealthCheckService.getAssignmentNotificationPolicy", () => {
  it("falls back to compile-time defaults when no association and no platform defaults", async () => {
    const service = buildServiceWithRows([]);
    const policy = await service.getAssignmentNotificationPolicy({
      systemId: "sys-1",
      configurationId: "cfg-1",
    });
    expect(policy).toEqual(DEFAULT_NOTIFICATION_POLICY);
  });

  it("falls back to platform defaults when association exists but notificationPolicy is null", async () => {
    const customPlatformDefault: NotificationPolicy = {
      suppressDeEscalations: true,
    };
    const service = buildServiceWithRows(
      [{ notificationPolicy: null }],
      customPlatformDefault,
    );
    const policy = await service.getAssignmentNotificationPolicy({
      systemId: "sys-1",
      configurationId: "cfg-1",
    });
    expect(policy.suppressDeEscalations).toBe(true);
  });

  it("falls back to platform defaults when no association exists", async () => {
    const customPlatformDefault: NotificationPolicy = {
      suppressDeEscalations: true,
    };
    const service = buildServiceWithRows([], customPlatformDefault);
    const policy = await service.getAssignmentNotificationPolicy({
      systemId: "sys-1",
      configurationId: "cfg-1",
    });
    expect(policy).toEqual({ suppressDeEscalations: true });
  });

  it("prefers per-assignment override over platform defaults", async () => {
    const platformDefault: NotificationPolicy = {
      suppressDeEscalations: false,
    };
    const assignmentOverride = {
      suppressDeEscalations: true, // overrides platform default
    };
    const service = buildServiceWithRows(
      [{ notificationPolicy: assignmentOverride }],
      platformDefault,
    );
    const policy = await service.getAssignmentNotificationPolicy({
      systemId: "sys-1",
      configurationId: "cfg-1",
    });
    expect(policy.suppressDeEscalations).toBe(true);
  });

  it("fills in defaults for an empty stored policy", async () => {
    const service = buildServiceWithRows([{ notificationPolicy: {} }]);
    const policy = await service.getAssignmentNotificationPolicy({
      systemId: "sys-1",
      configurationId: "cfg-1",
    });
    expect(policy).toEqual({ suppressDeEscalations: false });
  });

  it("strips removed legacy keys (auto-incident AND flapping) from stored rows without throwing", async () => {
    // A row persisted before the legacy auto-incident fields and the flapping
    // thresholds were removed still carries the larger object. The schema
    // strips the dead keys and keeps the one surviving field.
    const legacyOversizedRow = {
      notificationPolicy: {
        suppressDeEscalations: true,
        // Removed flapping thresholds — moved onto the automation trigger.
        flappingTrigger: { enabled: true, transitions: 7, windowMinutes: 45 },
        // Removed legacy auto-incident keys — must be dropped, not rejected.
        autoOpenIncidentOnUnhealthy: true,
        useNotificationSuppression: true,
        skipDuringMaintenance: true,
        sustainedUnhealthyTrigger: { enabled: true, durationMinutes: 15 },
        autoCloseAfterMinutes: 120,
      },
    };
    const service = buildServiceWithRows([legacyOversizedRow]);
    const policy = await service.getAssignmentNotificationPolicy({
      systemId: "sys-1",
      configurationId: "cfg-1",
    });
    expect(policy).toEqual({ suppressDeEscalations: true });
    expect(Object.keys(policy)).toEqual(["suppressDeEscalations"]);
  });
});
