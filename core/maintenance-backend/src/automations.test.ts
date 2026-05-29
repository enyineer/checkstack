/**
 * Behaviour tests for the maintenance automation triggers + actions.
 */
import { describe, expect, it, mock } from "bun:test";
import type { Logger } from "@checkstack/backend-api";
import { createMockLogger } from "@checkstack/test-utils-backend";

import {
  createMaintenanceActions,
  maintenanceArtifactType,
  maintenanceCreatedTrigger,
  maintenanceTriggers,
  maintenanceUpdatedTrigger,
} from "./automations";
import { maintenanceHooks } from "./hooks";
import type { MaintenanceService } from "./service";

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

// ─── Triggers ──────────────────────────────────────────────────────────

describe("maintenance triggers", () => {
  it("exposes two triggers in a stable order", () => {
    expect(maintenanceTriggers).toHaveLength(2);
    expect(maintenanceTriggers[0]).toBe(
      maintenanceCreatedTrigger as (typeof maintenanceTriggers)[number],
    );
    expect(maintenanceTriggers[1]).toBe(
      maintenanceUpdatedTrigger as (typeof maintenanceTriggers)[number],
    );
  });

  it("extracts maintenanceId as the contextKey on both triggers", () => {
    const payload = {
      maintenanceId: "m-1",
      systemIds: ["sys-1"],
      title: "Deploy",
      status: "scheduled" as const,
      startAt: "2026-05-29T11:00:00Z",
      endAt: "2026-05-29T12:00:00Z",
    };
    expect(maintenanceCreatedTrigger.contextKey?.(payload)).toBe("m-1");
    expect(
      maintenanceUpdatedTrigger.contextKey?.({ ...payload, action: "updated" }),
    ).toBe("m-1");
  });

  it("requires action enum on updated payload", () => {
    const ok = maintenanceUpdatedTrigger.payloadSchema.safeParse({
      maintenanceId: "m-1",
      systemIds: [],
      title: "Deploy",
      status: "completed",
      startAt: "2026-05-29T11:00:00Z",
      endAt: "2026-05-29T12:00:00Z",
      action: "closed",
    });
    const bad = maintenanceUpdatedTrigger.payloadSchema.safeParse({
      maintenanceId: "m-1",
      systemIds: [],
      title: "Deploy",
      status: "completed",
      startAt: "2026-05-29T11:00:00Z",
      endAt: "2026-05-29T12:00:00Z",
    });
    expect(ok.success).toBe(true);
    expect(bad.success).toBe(false);
  });
});

describe("maintenanceArtifactType", () => {
  it("validates the canonical artifact shape", () => {
    const ok = maintenanceArtifactType.schema.safeParse({
      maintenanceId: "m-1",
      status: "scheduled",
      systemIds: ["sys-1"],
      startAt: "2026-05-29T11:00:00Z",
      endAt: "2026-05-29T12:00:00Z",
    });
    expect(ok.success).toBe(true);
  });
});

// ─── Actions ───────────────────────────────────────────────────────────

interface FakeMaintenance {
  id: string;
  title: string;
  description?: string;
  status: string;
  systemIds: string[];
  startAt: Date;
  endAt: Date;
}

function makeService(args: {
  rowToReturn?: FakeMaintenance;
  updateReturn?: FakeMaintenance | undefined;
  getMaintenanceReturn?: FakeMaintenance | undefined;
  activeForSystem?: FakeMaintenance[];
  closeReturn?: FakeMaintenance | undefined;
}): MaintenanceService & {
  createMock: ReturnType<typeof mock>;
  updateMock: ReturnType<typeof mock>;
  addUpdateMock: ReturnType<typeof mock>;
  getMock: ReturnType<typeof mock>;
  activeMock: ReturnType<typeof mock>;
  closeMock: ReturnType<typeof mock>;
} {
  const createMock = mock(async (_input: unknown) => args.rowToReturn);
  const updateMock = mock(async (_input: unknown) => args.updateReturn);
  const addUpdateMock = mock(async (_input: unknown) => ({
    id: "upd-1",
    maintenanceId: "m-1",
    message: "x",
    statusChange: undefined,
    createdBy: undefined,
    createdAt: new Date(),
  }));
  const getMock = mock(async (_id: string) => args.getMaintenanceReturn);
  const activeMock = mock(async (_id: string) => args.activeForSystem ?? []);
  const closeMock = mock(async (_id: string, _msg?: string) => args.closeReturn);
  return {
    createMaintenance: createMock,
    updateMaintenance: updateMock,
    addUpdate: addUpdateMock,
    getMaintenance: getMock,
    getMaintenancesForSystem: activeMock,
    closeMaintenance: closeMock,
    createMock,
    updateMock,
    addUpdateMock,
    getMock,
    activeMock,
    closeMock,
  } as unknown as MaintenanceService & {
    createMock: ReturnType<typeof mock>;
    updateMock: ReturnType<typeof mock>;
    addUpdateMock: ReturnType<typeof mock>;
    getMock: ReturnType<typeof mock>;
    activeMock: ReturnType<typeof mock>;
    closeMock: ReturnType<typeof mock>;
  };
}

const sampleRow: FakeMaintenance = {
  id: "m-1",
  title: "Deploy",
  status: "scheduled",
  systemIds: ["sys-1"],
  startAt: new Date("2026-05-29T11:00:00Z"),
  endAt: new Date("2026-05-29T12:00:00Z"),
};

describe("maintenance.create", () => {
  it("creates a maintenance, fires maintenanceCreated, and emits a maintenance.window artifact", async () => {
    const service = makeService({ rowToReturn: sampleRow });
    const emitHook = mock(async (_hook: unknown, _payload: unknown) => {});
    const [create] = createMaintenanceActions({
      service,
      emitHook: emitHook as never,
    });

    const result = await create!.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: {
        title: "Deploy",
        systemIds: ["sys-1"],
        startAt: "2026-05-29T11:00:00Z",
        endAt: "2026-05-29T12:00:00Z",
      } as never,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.externalId).toBe("m-1");
    expect(emitHook).toHaveBeenCalledTimes(1);
    expect(emitHook.mock.calls[0]![0]).toBe(maintenanceHooks.maintenanceCreated);
  });
});

describe("maintenance.update", () => {
  it("returns failure when the maintenance doesn't exist", async () => {
    const service = makeService({ updateReturn: undefined });
    const emitHook = mock(async (_hook: unknown, _payload: unknown) => {});
    const [, update] = createMaintenanceActions({
      service,
      emitHook: emitHook as never,
    });

    const result = await update!.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: { maintenanceId: "missing", title: "x" } as never,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/not found/i);
    expect(emitHook).not.toHaveBeenCalled();
  });

  it("emits maintenanceUpdated with action='updated' on success", async () => {
    const service = makeService({ updateReturn: sampleRow });
    const emitHook = mock(async (_hook: unknown, _payload: unknown) => {});
    const [, update] = createMaintenanceActions({
      service,
      emitHook: emitHook as never,
    });

    const result = await update!.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: { maintenanceId: "m-1", title: "Deploy v2" } as never,
    });

    expect(result.success).toBe(true);
    const emitCall = emitHook.mock.calls[0]!;
    expect(emitCall[0]).toBe(maintenanceHooks.maintenanceUpdated);
    expect((emitCall[1] as { action: string }).action).toBe("updated");
  });
});

describe("maintenance.add_update", () => {
  it("uses action='closed' when statusChange is 'completed'", async () => {
    const service = makeService({
      getMaintenanceReturn: { ...sampleRow, status: "completed" },
    });
    const emitHook = mock(async (_hook: unknown, _payload: unknown) => {});
    const [, , addUpdate] = createMaintenanceActions({
      service,
      emitHook: emitHook as never,
    });

    const result = await addUpdate!.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: {
        maintenanceId: "m-1",
        message: "done",
        statusChange: "completed",
      } as never,
    });

    expect(result.success).toBe(true);
    expect((emitHook.mock.calls[0]![1] as { action: string }).action).toBe(
      "closed",
    );
  });

  it("returns failure when the maintenance vanishes between addUpdate and getMaintenance", async () => {
    const service = makeService({ getMaintenanceReturn: undefined });
    const emitHook = mock(async (_hook: unknown, _payload: unknown) => {});
    const [, , addUpdate] = createMaintenanceActions({
      service,
      emitHook: emitHook as never,
    });

    const result = await addUpdate!.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: { maintenanceId: "m-1", message: "x" } as never,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/not found/i);
    expect(emitHook).not.toHaveBeenCalled();
  });
});

describe("maintenance.set_system", () => {
  it("schedules a now+durationMinutes window covering one system", async () => {
    const service = makeService({ rowToReturn: sampleRow });
    const emitHook = mock(async (_hook: unknown, _payload: unknown) => {});
    const fixedNow = new Date("2026-05-29T11:00:00Z");
    const [, , , setSystem] = createMaintenanceActions({
      service,
      emitHook: emitHook as never,
      now: () => fixedNow,
    });

    await setSystem!.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: {
        systemId: "sys-1",
        durationMinutes: 60,
      } as never,
    });

    expect(service.createMock).toHaveBeenCalledTimes(1);
    const call = service.createMock.mock.calls[0]![0] as {
      systemIds: string[];
      startAt: Date;
      endAt: Date;
    };
    expect(call.systemIds).toEqual(["sys-1"]);
    expect(call.startAt.toISOString()).toBe("2026-05-29T11:00:00.000Z");
    expect(call.endAt.toISOString()).toBe("2026-05-29T12:00:00.000Z");
  });
});

describe("maintenance.clear_system", () => {
  it("closes every active window for the system + emits one updated hook per close", async () => {
    const window1 = { ...sampleRow, id: "m-1" };
    const window2 = { ...sampleRow, id: "m-2" };
    const service = makeService({
      activeForSystem: [window1, window2],
      closeReturn: window1,
    });
    // closeMaintenance returns the same row both times in the fixture
    // — that's fine for this test; we only assert the count + ids.
    const emitHook = mock(async (_hook: unknown, _payload: unknown) => {});
    const actions = createMaintenanceActions({
      service,
      emitHook: emitHook as never,
    });
    const clearSystem = actions[4]!;

    const result = await clearSystem.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: { systemId: "sys-1" } as never,
    });

    expect(result.success).toBe(true);
    expect(service.closeMock).toHaveBeenCalledTimes(2);
    expect(emitHook).toHaveBeenCalledTimes(2);
    for (const call of emitHook.mock.calls) {
      expect(call[0]).toBe(maintenanceHooks.maintenanceUpdated);
      expect((call[1] as { action: string }).action).toBe("closed");
    }
  });

  it("succeeds and emits an empty artifact when no windows are active for the system", async () => {
    const service = makeService({ activeForSystem: [] });
    const emitHook = mock(async (_hook: unknown, _payload: unknown) => {});
    const actions = createMaintenanceActions({
      service,
      emitHook: emitHook as never,
    });
    const clearSystem = actions[4]!;

    const result = await clearSystem.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: { systemId: "sys-1" } as never,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    const artifact = result.artifact as { closedMaintenanceIds: string[] };
    expect(artifact.closedMaintenanceIds).toEqual([]);
    expect(emitHook).not.toHaveBeenCalled();
  });
});
