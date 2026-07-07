/**
 * Behaviour tests for the healthcheck automation triggers + actions.
 */
import { describe, expect, it, mock } from "bun:test";
import type { Logger, RpcClient } from "@checkstack/backend-api";
import type { QueueManager } from "@checkstack/queue-api";
import { createMockLogger } from "@checkstack/test-utils-backend";

import {
  assignmentArtifactType,
  checkFailedTrigger,
  createHealthCheckActions,
  type HealthCheckActionDeps,
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
  rpcClient: { forPlugin: () => ({}) } as unknown as RpcClient,
};

describe("healthcheck triggers", () => {
  it("exposes four triggers in a stable order", () => {
    expect(healthCheckTriggers).toHaveLength(4);
    expect(healthCheckTriggers[0]).toBe(
      systemDegradedTrigger as unknown as (typeof healthCheckTriggers)[number],
    );
    expect(healthCheckTriggers[1]).toBe(
      systemHealthyTrigger as unknown as (typeof healthCheckTriggers)[number],
    );
    expect(healthCheckTriggers[2]).toBe(
      systemHealthChangedTrigger as unknown as (typeof healthCheckTriggers)[number],
    );
    expect(healthCheckTriggers[3]).toBe(
      checkFailedTrigger as unknown as (typeof healthCheckTriggers)[number],
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


  it("extracts systemId as the contextKey on all three (bare rollup, no environmentId)", () => {
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

  it("partitions the contextKey per-(system, environment) when environmentId is present", () => {
    // Per-env partition: two failing envs of one system share a SYSTEM
    // but NOT a flapping/dwell/dedup window — automations get N distinct
    // `system_health_changed` events with independent partitions. The bare
    // rollup change (no environmentId) keys on the bare systemId alone so
    // existing recipes keep working.
    const prodSpread = {
      systemId: "sys-1",
      environmentId: "prod",
      previousStatus: "healthy",
      newStatus: "unhealthy",
      healthyChecks: 1,
      totalChecks: 2,
      timestamp: "2026-05-29T11:00:00Z",
    } as const;
    const stagingSpread = {
      ...prodSpread,
      environmentId: "staging",
    } as const;
    const rollup = {
      systemId: "sys-1",
      previousStatus: "degraded",
      newStatus: "unhealthy",
      healthyChecks: 1,
      totalChecks: 2,
      timestamp: "2026-05-29T11:00:00Z",
    } as const;

    expect(systemHealthChangedTrigger.contextKey?.(prodSpread)).toBe(
      "sys-1::prod",
    );
    expect(systemHealthChangedTrigger.contextKey?.(stagingSpread)).toBe(
      "sys-1::staging",
    );
    // Rollup stays system-scoped.
    expect(systemHealthChangedTrigger.contextKey?.(rollup)).toBe("sys-1");
    // The directional triggers use the SAME partition function (they share
    // the schema's { systemId, environmentId? } fields by structural type).
    expect(systemDegradedTrigger.contextKey?.(prodSpread)).toBe("sys-1::prod");
    expect(systemHealthyTrigger.contextKey?.(prodSpread)).toBe("sys-1::prod");
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
  enqueueEnvironmentIds?: (string | null)[];
}): HealthCheckService & { setMock: ReturnType<typeof mock> } {
  const setMock = mock(
    async (_sysId: string, _cfgId: string, _enabled: boolean) =>
      args.setAssignmentEnabledReturn ?? true,
  );
  const resolveEnqueueEnvironmentIds = mock(
    async () => args.enqueueEnvironmentIds ?? [null],
  );
  return {
    setAssignmentEnabled: setMock,
    resolveEnqueueEnvironmentIds,
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

// The actions only need a catalog client shape for `run_now`, which delegates
// environment resolution to the service mock, so a bare stub suffices.
const catalogClientStub =
  {} as unknown as HealthCheckActionDeps["catalogClient"];

describe("healthcheck.run_now", () => {
  it("enqueues a one-off job and emits an enqueued=true artifact", async () => {
    const service = makeService({});
    const { queueManager, enqueueMock } = makeQueueManager();
    const emitHook = mock(async (_hook: unknown, _payload: unknown) => {});
    const [runNow] = createHealthCheckActions({
      service,
      queueManager,
      catalogClient: catalogClientStub,
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
      environmentId: null,
    });
    // run_now doesn't mutate any DB row → no hook to emit.
    expect(emitHook).not.toHaveBeenCalled();
  });

  it("enqueues one job per effective environment slice", async () => {
    const service = makeService({ enqueueEnvironmentIds: ["prod", "staging"] });
    const { queueManager, enqueueMock } = makeQueueManager();
    const emitHook = mock(async (_hook: unknown, _payload: unknown) => {});
    const [runNow] = createHealthCheckActions({
      service,
      queueManager,
      catalogClient: catalogClientStub,
      emitHook: emitHook as never,
    });

    const result = await runNow!.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: { systemId: "sys-1", configurationId: "cfg-1" } as never,
    });

    expect(result.success).toBe(true);
    expect(enqueueMock).toHaveBeenCalledTimes(2);
    expect(enqueueMock.mock.calls[0]![0]).toEqual({
      configId: "cfg-1",
      systemId: "sys-1",
      environmentId: "prod",
    });
    expect(enqueueMock.mock.calls[1]![0]).toEqual({
      configId: "cfg-1",
      systemId: "sys-1",
      environmentId: "staging",
    });
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
      catalogClient: catalogClientStub,
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
      catalogClient: catalogClientStub,
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
      catalogClient: catalogClientStub,
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
