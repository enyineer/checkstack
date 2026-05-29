import { describe, it, expect, mock } from "bun:test";
import { HealthCheckService } from "./service";
import { createMockDb } from "@checkstack/test-utils-backend";

/**
 * Stand up a `HealthCheckService` whose only DB interaction is the
 * select chain used by `getSystemNotificationPolicy`. Returns the rows
 * verbatim so individual tests can shape the aggregation input.
 */
function buildServiceWithRows(
  rows: { notificationPolicy: { suppressDeEscalations: boolean } | null }[],
): HealthCheckService {
  const mockDb = createMockDb();
  const whereChain = mock(async () => rows);
  const fromChain = mock(() => ({ where: whereChain }));
  const selectChain = mock(() => ({ from: fromChain }));
  (mockDb as { select: unknown }).select = selectChain;

  return new HealthCheckService(mockDb as never, {} as never, {} as never);
}

describe("HealthCheckService.getSystemNotificationPolicy", () => {
  it("defaults to suppressDeEscalations=false when no associations exist", async () => {
    const service = buildServiceWithRows([]);
    const policy = await service.getSystemNotificationPolicy("sys-1");
    expect(policy.suppressDeEscalations).toBe(false);
  });

  it("defaults to suppressDeEscalations=false when all associations omit the policy", async () => {
    const service = buildServiceWithRows([
      { notificationPolicy: null },
      { notificationPolicy: null },
    ]);
    const policy = await service.getSystemNotificationPolicy("sys-1");
    expect(policy.suppressDeEscalations).toBe(false);
  });

  it("returns suppressDeEscalations=true when any single association opts in (any-of)", async () => {
    const service = buildServiceWithRows([
      { notificationPolicy: null },
      { notificationPolicy: { suppressDeEscalations: true } },
      { notificationPolicy: { suppressDeEscalations: false } },
    ]);
    const policy = await service.getSystemNotificationPolicy("sys-1");
    expect(policy.suppressDeEscalations).toBe(true);
  });

  it("returns suppressDeEscalations=false when every association explicitly opts out", async () => {
    const service = buildServiceWithRows([
      { notificationPolicy: { suppressDeEscalations: false } },
      { notificationPolicy: { suppressDeEscalations: false } },
    ]);
    const policy = await service.getSystemNotificationPolicy("sys-1");
    expect(policy.suppressDeEscalations).toBe(false);
  });
});
