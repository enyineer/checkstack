/**
 * Unit tests for the maintenance reactive-entity mapping (reactive
 * automation engine §10.2). Proves the deriver returns the EXACT qualified
 * trigger event ids existing automations match, and the mirror state builder
 * produces the §10.2 entity shape.
 */
import { describe, expect, it } from "bun:test";
import { SYSTEM_ACTOR } from "@checkstack/common";
import type { EntityChanged } from "@checkstack/automation-common";

import {
  MAINTENANCE_CREATED_EVENT,
  MAINTENANCE_UPDATED_EVENT,
  deriveMaintenanceEvents,
  maintenanceEntityStateSchema,
  toMaintenanceEntityState,
} from "./entity";

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
