/**
 * Behaviour tests for the maintenance automation actions.
 *
 * Phase 4 (reactive automation engine §10.2) replaced the hook-backed
 * `maintenance.created` / `maintenance.updated` triggers with the reactive
 * `maintenance` entity. Mutation actions now mirror window state through the
 * entity handle; these tests assert the mirror writes the §10.2 entity shape
 * keyed by maintenance id.
 */
import { describe, expect, it, mock } from "bun:test";
import type { Logger } from "@checkstack/backend-api";
import type {
  EntityHandle,
  EntityMutationOpts,
} from "@checkstack/automation-backend";
import { createMockLogger } from "@checkstack/test-utils-backend";

import {
  createMaintenanceActions,
  maintenanceArtifactType,
} from "./automations";
import type { MaintenanceEntityState } from "./entity";
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

interface RecordedSet {
  id: string;
  next: MaintenanceEntityState;
  opts?: EntityMutationOpts;
}

/** A fake entity handle that records `set` / `remove` calls for assertion. */
function makeEntityHandle(): EntityHandle<MaintenanceEntityState> & {
  sets: RecordedSet[];
  removes: string[];
} {
  const sets: RecordedSet[] = [];
  const removes: string[] = [];
  return {
    kind: "maintenance",
    sets,
    removes,
    async set(id, next, opts) {
      sets.push({ id, next, opts });
    },
    async patch() {},
    async mutate() {
      throw new Error("not used in these tests");
    },
    async get() {
      return undefined;
    },
    async getMany() {
      return {};
    },
    async remove(inputOrId: unknown) {
      // The deprecated store-owned `remove(id)` form is what the maintenance
      // automations call; record the id.
      if (typeof inputOrId === "string") removes.push(inputOrId);
    },
    async inStateSince() {
      return null;
    },
    async inStateForMs() {
      return 0;
    },
    async transitionCount() {
      return 0;
    },
  };
}

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
  it("creates a maintenance, mirrors the entity state, and emits a maintenance.window artifact", async () => {
    const service = makeService({ rowToReturn: sampleRow });
    const entityHandle = makeEntityHandle();
    const [create] = createMaintenanceActions({ service, entityHandle });

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
    expect(entityHandle.sets).toHaveLength(1);
    expect(entityHandle.sets[0]!.id).toBe("m-1");
    expect(entityHandle.sets[0]!.next).toEqual({
      status: "scheduled",
      systemIds: ["sys-1"],
      startAt: "2026-05-29T11:00:00.000Z",
      endAt: "2026-05-29T12:00:00.000Z",
    });
    // Run-originated writes carry the runId (masking) + the run actor.
    expect(entityHandle.sets[0]!.opts?.runId).toBe("run-1");
  });
});

describe("maintenance.update", () => {
  it("returns failure and mirrors nothing when the maintenance doesn't exist", async () => {
    const service = makeService({ updateReturn: undefined });
    const entityHandle = makeEntityHandle();
    const [, update] = createMaintenanceActions({ service, entityHandle });

    const result = await update!.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: { maintenanceId: "missing", title: "x" } as never,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/not found/i);
    expect(entityHandle.sets).toHaveLength(0);
  });

  it("mirrors the updated state on success", async () => {
    const service = makeService({
      updateReturn: { ...sampleRow, status: "in_progress" },
    });
    const entityHandle = makeEntityHandle();
    const [, update] = createMaintenanceActions({ service, entityHandle });

    const result = await update!.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: { maintenanceId: "m-1", title: "Deploy v2" } as never,
    });

    expect(result.success).toBe(true);
    expect(entityHandle.sets).toHaveLength(1);
    expect(entityHandle.sets[0]!.next.status).toBe("in_progress");
  });
});

describe("maintenance.add_update", () => {
  it("mirrors the refreshed state when statusChange is 'completed'", async () => {
    const service = makeService({
      getMaintenanceReturn: { ...sampleRow, status: "completed" },
    });
    const entityHandle = makeEntityHandle();
    const [, , addUpdate] = createMaintenanceActions({ service, entityHandle });

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
    expect(entityHandle.sets).toHaveLength(1);
    expect(entityHandle.sets[0]!.next.status).toBe("completed");
  });

  it("returns failure when the maintenance vanishes between addUpdate and getMaintenance", async () => {
    const service = makeService({ getMaintenanceReturn: undefined });
    const entityHandle = makeEntityHandle();
    const [, , addUpdate] = createMaintenanceActions({ service, entityHandle });

    const result = await addUpdate!.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: { maintenanceId: "m-1", message: "x" } as never,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/not found/i);
    expect(entityHandle.sets).toHaveLength(0);
  });
});

describe("maintenance.set_system", () => {
  it("schedules a now+durationMinutes window and mirrors it covering one system", async () => {
    const service = makeService({ rowToReturn: sampleRow });
    const entityHandle = makeEntityHandle();
    const fixedNow = new Date("2026-05-29T11:00:00Z");
    const [, , , setSystem] = createMaintenanceActions({
      service,
      entityHandle,
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
    expect(entityHandle.sets).toHaveLength(1);
    expect(entityHandle.sets[0]!.next.systemIds).toEqual(["sys-1"]);
  });
});

describe("maintenance.clear_system", () => {
  it("closes every active window for the system + mirrors one state per close", async () => {
    const window1 = { ...sampleRow, id: "m-1", status: "completed" };
    const window2 = { ...sampleRow, id: "m-2" };
    const service = makeService({
      activeForSystem: [window1, window2],
      closeReturn: window1,
    });
    // closeMaintenance returns the same row both times in the fixture
    // — that's fine for this test; we only assert the count + ids.
    const entityHandle = makeEntityHandle();
    const actions = createMaintenanceActions({ service, entityHandle });
    const clearSystem = actions[4]!;

    const result = await clearSystem.execute({
      ...ctxBase,
      consumedArtifacts: {},
      config: { systemId: "sys-1" } as never,
    });

    expect(result.success).toBe(true);
    expect(service.closeMock).toHaveBeenCalledTimes(2);
    expect(entityHandle.sets).toHaveLength(2);
    for (const recorded of entityHandle.sets) {
      expect(recorded.next.status).toBe("completed");
    }
  });

  it("succeeds and mirrors nothing when no windows are active for the system", async () => {
    const service = makeService({ activeForSystem: [] });
    const entityHandle = makeEntityHandle();
    const actions = createMaintenanceActions({ service, entityHandle });
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
    expect(entityHandle.sets).toHaveLength(0);
  });
});
