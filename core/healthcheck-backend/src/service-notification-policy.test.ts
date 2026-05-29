import { describe, it, expect, mock } from "bun:test";
import { HealthCheckService } from "./service";
import { createMockDb } from "@checkstack/test-utils-backend";
import { DEFAULT_NOTIFICATION_POLICY } from "@checkstack/healthcheck-common";

/**
 * Build a service whose only DB interaction is the chain used by
 * `getAssignmentNotificationPolicy`. The chain ends in `.limit(1)` and
 * returns the supplied rows verbatim.
 */
function buildServiceWithRows(rows: unknown[]): HealthCheckService {
  const mockDb = createMockDb();
  const limitChain = mock(async () => rows);
  const whereChain = mock(() => ({ limit: limitChain }));
  const fromChain = mock(() => ({ where: whereChain }));
  const selectChain = mock(() => ({ from: fromChain }));
  (mockDb as { select: unknown }).select = selectChain;

  return new HealthCheckService(mockDb as never, {} as never, {} as never);
}

describe("HealthCheckService.getAssignmentNotificationPolicy", () => {
  it("falls back to platform defaults when no association exists", async () => {
    const service = buildServiceWithRows([]);
    const policy = await service.getAssignmentNotificationPolicy({
      systemId: "sys-1",
      configurationId: "cfg-1",
    });
    expect(policy).toEqual(DEFAULT_NOTIFICATION_POLICY);
  });

  it("returns defaults when association exists but notificationPolicy is null", async () => {
    const service = buildServiceWithRows([{ notificationPolicy: null }]);
    const policy = await service.getAssignmentNotificationPolicy({
      systemId: "sys-1",
      configurationId: "cfg-1",
    });
    expect(policy).toEqual(DEFAULT_NOTIFICATION_POLICY);
  });

  it("fills in defaults for partial stored policies", async () => {
    // Older rows may have only `suppressDeEscalations` set from the
    // first migration. The new auto-incident fields must default in.
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
    expect(policy.incidentThreshold).toEqual({
      transitions: 1,
      windowMinutes: 60,
    });
  });

  it("returns explicit values exactly when fully specified", async () => {
    const service = buildServiceWithRows([
      {
        notificationPolicy: {
          suppressDeEscalations: false,
          autoOpenIncidentOnUnhealthy: false,
          useNotificationSuppression: false,
          incidentThreshold: { transitions: 3, windowMinutes: 30 },
        },
      },
    ]);
    const policy = await service.getAssignmentNotificationPolicy({
      systemId: "sys-1",
      configurationId: "cfg-1",
    });
    expect(policy.suppressDeEscalations).toBe(false);
    expect(policy.autoOpenIncidentOnUnhealthy).toBe(false);
    expect(policy.useNotificationSuppression).toBe(false);
    expect(policy.incidentThreshold).toEqual({
      transitions: 3,
      windowMinutes: 30,
    });
  });
});
