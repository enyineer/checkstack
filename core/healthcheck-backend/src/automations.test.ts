/**
 * Behaviour tests for the healthcheck automation triggers + actions.
 */
import { describe, expect, it, mock } from "bun:test";
import type { Logger } from "@checkstack/backend-api";
import type { QueueManager } from "@checkstack/queue-api";
import { createMockLogger } from "@checkstack/test-utils-backend";

import {
  assignmentArtifactType,
  checkFailedTrigger,
  createHealthCheckActions,
  flappingDetectedTrigger,
  healthCheckTriggers,
  systemDegradedTrigger,
  systemHealthChangedTrigger,
  systemHealthyTrigger,
} from "./automations";
import { healthCheckHooks } from "./hooks";
import type { HealthCheckService } from "./service";

const logger = createMockLogger() as Logger;

const ctxBase = {
  runId: "run-1",
  automationId: "auto-1",
  contextKey: null,
  logger,
  getService: async <T,>(): Promise<T> => {
    throw new Error("not used");
  },
};

describe("healthcheck triggers", () => {
  it("exposes five triggers in a stable order", () => {
    expect(healthCheckTriggers).toHaveLength(5);
    expect(healthCheckTriggers[0]).toBe(
      systemDegradedTrigger as (typeof healthCheckTriggers)[number],
    );
    expect(healthCheckTriggers[1]).toBe(
      systemHealthyTrigger as (typeof healthCheckTriggers)[number],
    );
    expect(healthCheckTriggers[2]).toBe(
      systemHealthChangedTrigger as (typeof healthCheckTriggers)[number],
    );
    expect(healthCheckTriggers[3]).toBe(
      checkFailedTrigger as (typeof healthCheckTriggers)[number],
    );
    expect(healthCheckTriggers[4]).toBe(
      flappingDetectedTrigger as (typeof healthCheckTriggers)[number],
    );
  });

  it("validates checkFailed payload and extracts systemId", () => {
    const ok = checkFailedTrigger.payloadSchema.safeParse({
      systemId: "sys-1",
      configurationId: "cfg-1",
      status: "unhealthy",
      timestamp: "2026-05-29T12:00:00Z",
    });
    expect(ok.success).toBe(true);
    expect(
      checkFailedTrigger.contextKey?.({
        systemId: "sys-1",
        configurationId: "cfg-1",
        status: "unhealthy",
        timestamp: "2026-05-29T12:00:00Z",
      }),
    ).toBe("sys-1");
  });

  it("validates flappingDetected payload and requires transitionCount + windowMinutes", () => {
    const ok = flappingDetectedTrigger.payloadSchema.safeParse({
      systemId: "sys-1",
      configurationId: "cfg-1",
      transitionCount: 5,
      windowMinutes: 10,
      timestamp: "2026-05-29T12:00:00Z",
    });
    expect(ok.success).toBe(true);

    const bad = flappingDetectedTrigger.payloadSchema.safeParse({
      systemId: "sys-1",
      configurationId: "cfg-1",
      timestamp: "2026-05-29T12:00:00Z",
    });
    expect(bad.success).toBe(false);
  });

  it("extracts systemId as the contextKey on all three", () => {
    const degradedOrChanged = {
      systemId: "sys-1",
      previousStatus: "healthy",
      newStatus: "degraded",
      healthyChecks: 1,
      totalChecks: 2,
      timestamp: "2026-05-29T11:00:00Z",
    } as const;
    const healthy = {
      systemId: "sys-1",
      previousStatus: "degraded",
      healthyChecks: 2,
      totalChecks: 2,
      timestamp: "2026-05-29T11:00:00Z",
    } as const;
    expect(systemDegradedTrigger.contextKey?.(degradedOrChanged)).toBe("sys-1");
    expect(systemHealthyTrigger.contextKey?.(healthy)).toBe("sys-1");
    expect(systemHealthChangedTrigger.contextKey?.(degradedOrChanged)).toBe(
      "sys-1",
    );
  });
});

describe("assignmentArtifactType", () => {
  it("validates the canonical assignment artifact", () => {
    const ok = assignmentArtifactType.schema.safeParse({
      systemId: "sys-1",
      configurationId: "cfg-1",
      enabled: true,
    });
    expect(ok.success).toBe(true);
  });
});

function makeService(args: {
  setAssignmentEnabledReturn?: boolean;
}): HealthCheckService & { setMock: ReturnType<typeof mock> } {
  const setMock = mock(
    async (_sysId: string, _cfgId: string, _enabled: boolean) =>
      args.setAssignmentEnabledReturn ?? true,
  );
  return {
    setAssignmentEnabled: setMock,
    setMock,
  } as unknown as HealthCheckService & { setMock: ReturnType<typeof mock> };
}

interface QueueEnqueueRecorder {
  queueManager: QueueManager;
  enqueueMock: ReturnType<typeof mock>;
}

function makeQueueManager(): QueueEnqueueRecorder {
  const enqueueMock = mock(async (_payload: unknown) => "job-id");
  const queue = {
    enqueue: enqueueMock,
    // Other queue methods aren't exercised by the action.
  };
  const queueManager = {
    getQueue: () => queue,
  } as unknown as QueueManager;
  return { queueManager, enqueueMock };
}

describe("healthcheck.run_now", () => {
  it("enqueues a one-off job and emits an enqueued=true artifact", async () => {
    const service = makeService({});
    const { queueManager, enqueueMock } = makeQueueManager();
    const emitHook = mock(async (_hook: unknown, _payload: unknown) => {});
    const [runNow] = createHealthCheckActions({
      service,
      queueManager,
      emitHook: emitHook as never,
    });

    const result = await runNow!.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: { systemId: "sys-1", configurationId: "cfg-1" } as never,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.externalId).toBe("sys-1:cfg-1");
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock.mock.calls[0]![0]).toEqual({
      configId: "cfg-1",
      systemId: "sys-1",
    });
    // run_now doesn't mutate any DB row → no hook to emit.
    expect(emitHook).not.toHaveBeenCalled();
  });
});

describe("healthcheck.enable_assignment", () => {
  it("flips enabled=true on the existing row, fires assignmentChanged, and emits the artifact", async () => {
    const service = makeService({ setAssignmentEnabledReturn: true });
    const { queueManager } = makeQueueManager();
    const emitHook = mock(async (_hook: unknown, _payload: unknown) => {});
    const [, enable] = createHealthCheckActions({
      service,
      queueManager,
      emitHook: emitHook as never,
    });

    const result = await enable!.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: { systemId: "sys-1", configurationId: "cfg-1" } as never,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect((result.artifact as { enabled: boolean }).enabled).toBe(true);
    expect(service.setMock).toHaveBeenCalledWith("sys-1", "cfg-1", true);
    expect(emitHook).toHaveBeenCalledTimes(1);
    expect(emitHook.mock.calls[0]![0]).toBe(healthCheckHooks.assignmentChanged);
  });

  it("returns failure when the assignment row does not exist", async () => {
    const service = makeService({ setAssignmentEnabledReturn: false });
    const { queueManager } = makeQueueManager();
    const emitHook = mock(async (_hook: unknown, _payload: unknown) => {});
    const [, enable] = createHealthCheckActions({
      service,
      queueManager,
      emitHook: emitHook as never,
    });

    const result = await enable!.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: { systemId: "sys-1", configurationId: "missing" } as never,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/Assignment not found/);
    expect(emitHook).not.toHaveBeenCalled();
  });
});

describe("healthcheck.disable_assignment", () => {
  it("flips enabled=false on the existing row and emits the artifact", async () => {
    const service = makeService({ setAssignmentEnabledReturn: true });
    const { queueManager } = makeQueueManager();
    const emitHook = mock(async (_hook: unknown, _payload: unknown) => {});
    const [, , disable] = createHealthCheckActions({
      service,
      queueManager,
      emitHook: emitHook as never,
    });

    const result = await disable!.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: { systemId: "sys-1", configurationId: "cfg-1" } as never,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect((result.artifact as { enabled: boolean }).enabled).toBe(false);
    expect(service.setMock).toHaveBeenCalledWith("sys-1", "cfg-1", false);
  });
});
