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
      ...DEFAULT_NOTIFICATION_POLICY,
      autoCloseAfterMinutes: 120,
      sustainedUnhealthyTrigger: { enabled: true, durationMinutes: 15 },
    };
    const service = buildServiceWithRows(
      [{ notificationPolicy: null }],
      customPlatformDefault,
    );
    const policy = await service.getAssignmentNotificationPolicy({
      systemId: "sys-1",
      configurationId: "cfg-1",
    });
    expect(policy.autoCloseAfterMinutes).toBe(120);
    expect(policy.sustainedUnhealthyTrigger.durationMinutes).toBe(15);
  });

  it("falls back to platform defaults when no association exists", async () => {
    const customPlatformDefault: NotificationPolicy = {
      ...DEFAULT_NOTIFICATION_POLICY,
      flappingTrigger: { enabled: true, transitions: 10, windowMinutes: 30 },
    };
    const service = buildServiceWithRows([], customPlatformDefault);
    const policy = await service.getAssignmentNotificationPolicy({
      systemId: "sys-1",
      configurationId: "cfg-1",
    });
    expect(policy.flappingTrigger).toEqual({
      enabled: true,
      transitions: 10,
      windowMinutes: 30,
    });
  });

  it("prefers per-assignment override over platform defaults", async () => {
    const platformDefault: NotificationPolicy = {
      ...DEFAULT_NOTIFICATION_POLICY,
      autoOpenIncidentOnUnhealthy: false,
    };
    const assignmentOverride = {
      suppressDeEscalations: true,
      autoOpenIncidentOnUnhealthy: true, // overrides platform default
      useNotificationSuppression: true,
      skipDuringMaintenance: true,
      sustainedUnhealthyTrigger: { enabled: true, durationMinutes: 30 },
      flappingTrigger: { enabled: true, transitions: 3, windowMinutes: 60 },
      autoCloseAfterMinutes: 30,
    };
    const service = buildServiceWithRows(
      [{ notificationPolicy: assignmentOverride }],
      platformDefault,
    );
    const policy = await service.getAssignmentNotificationPolicy({
      systemId: "sys-1",
      configurationId: "cfg-1",
    });
    expect(policy.autoOpenIncidentOnUnhealthy).toBe(true);
    expect(policy.suppressDeEscalations).toBe(true);
  });

  it("fills in defaults for partial stored policies", async () => {
    // Older rows may have only `suppressDeEscalations` set from the
    // first migration. All other fields must default in.
    const service = buildServiceWithRows([
      { notificationPolicy: { suppressDeEscalations: true } },
    ]);
    const policy = await service.getAssignmentNotificationPolicy({
      systemId: "sys-1",
      configurationId: "cfg-1",
    });
    expect(policy.suppressDeEscalations).toBe(true);
    expect(policy.autoOpenIncidentOnUnhealthy).toBe(true);
    expect(policy.useNotificationSuppression).toBe(true);
    expect(policy.skipDuringMaintenance).toBe(true);
    expect(policy.sustainedUnhealthyTrigger).toEqual({
      enabled: true,
      durationMinutes: 30,
    });
    expect(policy.flappingTrigger).toEqual({
      enabled: true,
      transitions: 3,
      windowMinutes: 60,
    });
    expect(policy.autoCloseAfterMinutes).toBe(30);
  });

  it("returns explicit values exactly when fully specified", async () => {
    const service = buildServiceWithRows([
      {
        notificationPolicy: {
          suppressDeEscalations: false,
          autoOpenIncidentOnUnhealthy: false,
          useNotificationSuppression: false,
          skipDuringMaintenance: false,
          sustainedUnhealthyTrigger: { enabled: false, durationMinutes: 15 },
          flappingTrigger: {
            enabled: true,
            transitions: 5,
            windowMinutes: 30,
          },
          autoCloseAfterMinutes: null,
        },
      },
    ]);
    const policy = await service.getAssignmentNotificationPolicy({
      systemId: "sys-1",
      configurationId: "cfg-1",
    });
    expect(policy.autoOpenIncidentOnUnhealthy).toBe(false);
    expect(policy.skipDuringMaintenance).toBe(false);
    expect(policy.sustainedUnhealthyTrigger).toEqual({
      enabled: false,
      durationMinutes: 15,
    });
    expect(policy.flappingTrigger).toEqual({
      enabled: true,
      transitions: 5,
      windowMinutes: 30,
    });
    expect(policy.autoCloseAfterMinutes).toBeNull();
  });
});
