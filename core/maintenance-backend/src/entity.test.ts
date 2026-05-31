/**
 * Unit tests for the maintenance reactive-entity mapping (reactive
 * automation engine §10.2). Proves the deriver returns the EXACT qualified
 * trigger event ids existing automations match, the state builder produces
 * the §10.2 entity shape, and the PLUGIN-BACKED `read`/`mutate`/`remove`
 * helpers route to the service (no framework `entity_state`).
 */
import { describe, expect, it } from "bun:test";
import { SYSTEM_ACTOR } from "@checkstack/common";
import type {
  EntityChanged,
  EntityHandle,
} from "@checkstack/automation-backend";

import {
  MAINTENANCE_CREATED_EVENT,
  MAINTENANCE_ENTITY_KIND,
  MAINTENANCE_UPDATED_EVENT,
  createMaintenanceEntityRead,
  deriveMaintenanceEvents,
  maintenanceEntityStateSchema,
  removeMaintenanceEntity,
  toMaintenanceEntityState,
  writeMaintenanceEntity,
  type MaintenanceEntityState,
} from "./entity";
import type { MaintenanceService } from "./service";

function makeChange(over: Partial<EntityChanged>): EntityChanged {
  return {
    kind: "maintenance",
    id: "m-1",
    prev: null,
    next: { status: "scheduled", systemIds: [], startAt: "a", endAt: "b" },
    delta: {},
    changedFields: [],
    actor: SYSTEM_ACTOR,
    occurredAt: "2026-05-31T00:00:00.000Z",
    ...over,
  };
}

describe("deriveMaintenanceEvents", () => {
  it("maps a create (prev === null) to maintenance.created", () => {
    const events = deriveMaintenanceEvents(makeChange({ prev: null }));
    expect(events).toEqual([MAINTENANCE_CREATED_EVENT]);
  });

  it("maps an update (prev present, next present) to maintenance.updated", () => {
    const events = deriveMaintenanceEvents(
      makeChange({
        prev: { status: "scheduled", systemIds: [], startAt: "a", endAt: "b" },
        next: { status: "in_progress", systemIds: [], startAt: "a", endAt: "b" },
      }),
    );
    expect(events).toEqual([MAINTENANCE_UPDATED_EVENT]);
  });

  it("maps a tombstone (next === null) to no event", () => {
    const events = deriveMaintenanceEvents(
      makeChange({
        prev: { status: "scheduled", systemIds: [], startAt: "a", endAt: "b" },
        next: null,
      }),
    );
    expect(events).toEqual([]);
  });

  it("returns event ids that exactly equal the qualified trigger ids", () => {
    // The created/updated trigger ids are namespaced to `${pluginId}.${id}`
    // → `maintenance.created` / `maintenance.updated`. Lock the constants.
    expect(MAINTENANCE_CREATED_EVENT).toBe("maintenance.created");
    expect(MAINTENANCE_UPDATED_EVENT).toBe("maintenance.updated");
  });
});

describe("toMaintenanceEntityState", () => {
  it("serializes Date columns to ISO strings and validates against the schema", () => {
    const state = toMaintenanceEntityState({
      status: "scheduled",
      systemIds: ["sys-1", "sys-2"],
      startAt: new Date("2026-05-29T11:00:00Z"),
      endAt: new Date("2026-05-29T12:00:00Z"),
    });
    expect(state).toEqual({
      status: "scheduled",
      systemIds: ["sys-1", "sys-2"],
      startAt: "2026-05-29T11:00:00.000Z",
      endAt: "2026-05-29T12:00:00.000Z",
    });
    expect(() => maintenanceEntityStateSchema.parse(state)).not.toThrow();
  });

  it("passes through already-ISO strings unchanged", () => {
    const state = toMaintenanceEntityState({
      status: "completed",
      systemIds: [],
      startAt: "2026-05-29T11:00:00.000Z",
      endAt: "2026-05-29T12:00:00.000Z",
    });
    expect(state.startAt).toBe("2026-05-29T11:00:00.000Z");
    expect(state.endAt).toBe("2026-05-29T12:00:00.000Z");
  });
});

describe("createMaintenanceEntityRead", () => {
  it("routes the batched read straight to the service (plugin-backed)", async () => {
    const seen: ReadonlyArray<string>[] = [];
    const service = {
      async getManyEntityStates(ids: ReadonlyArray<string>) {
        seen.push(ids);
        return {
          "m-1": {
            status: "scheduled" as const,
            systemIds: ["sys-1"],
            startAt: "2026-05-29T11:00:00.000Z",
            endAt: "2026-05-29T12:00:00.000Z",
          },
        };
      },
    } as unknown as MaintenanceService;
    const read = createMaintenanceEntityRead(service);
    const out = await read(["m-1", "m-2"]);
    expect(seen).toEqual([["m-1", "m-2"]]);
    expect(out["m-1"]).toEqual({
      status: "scheduled",
      systemIds: ["sys-1"],
      startAt: "2026-05-29T11:00:00.000Z",
      endAt: "2026-05-29T12:00:00.000Z",
    });
  });
});

describe("writeMaintenanceEntity", () => {
  it("drives the write through handle.mutate keyed by maintenance id", async () => {
    const calls: Array<{ id: string; next: MaintenanceEntityState }> = [];
    const handle = {
      kind: MAINTENANCE_ENTITY_KIND,
      async mutate(input: {
        id: string;
        apply: () => Promise<MaintenanceEntityState>;
      }) {
        const next = await input.apply();
        calls.push({ id: input.id, next });
        return next;
      },
    } as unknown as EntityHandle<MaintenanceEntityState>;

    let applied = false;
    await writeMaintenanceEntity({
      handle,
      maintenanceId: "m-9",
      apply: async () => {
        applied = true;
        return {
          status: "in_progress",
          systemIds: ["sys-1"],
          startAt: "2026-05-29T11:00:00.000Z",
          endAt: "2026-05-29T12:00:00.000Z",
        };
      },
    });
    expect(applied).toBe(true);
    expect(calls).toEqual([
      {
        id: "m-9",
        next: {
          status: "in_progress",
          systemIds: ["sys-1"],
          startAt: "2026-05-29T11:00:00.000Z",
          endAt: "2026-05-29T12:00:00.000Z",
        },
      },
    ]);
  });

  it("still runs the plugin write when no handle is wired", async () => {
    let applied = false;
    await writeMaintenanceEntity({
      handle: undefined,
      maintenanceId: "m-9",
      apply: async () => {
        applied = true;
        return {
          status: "scheduled",
          systemIds: [],
          startAt: "a",
          endAt: "b",
        };
      },
    });
    expect(applied).toBe(true);
  });
});

describe("removeMaintenanceEntity", () => {
  it("tombstones via handle.remove({ apply })", async () => {
    const removed: string[] = [];
    let deleted = false;
    const handle = {
      kind: MAINTENANCE_ENTITY_KIND,
      async remove(input: { id: string; apply: () => Promise<void> }) {
        await input.apply();
        removed.push(input.id);
      },
    } as unknown as EntityHandle<MaintenanceEntityState>;
    await removeMaintenanceEntity({
      handle,
      maintenanceId: "m-9",
      apply: async () => {
        deleted = true;
      },
    });
    expect(deleted).toBe(true);
    expect(removed).toEqual(["m-9"]);
  });

  it("still runs the delete when no handle is wired", async () => {
    let deleted = false;
    await removeMaintenanceEntity({
      handle: undefined,
      maintenanceId: "m-9",
      apply: async () => {
        deleted = true;
      },
    });
    expect(deleted).toBe(true);
  });
});
