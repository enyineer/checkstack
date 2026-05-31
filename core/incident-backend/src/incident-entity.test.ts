import { describe, it, expect } from "bun:test";
import type {
  EntityChanged,
  EntityHandle,
} from "@checkstack/automation-backend";
import { SYSTEM_ACTOR } from "@checkstack/common";

import {
  INCIDENT_ENTITY_KIND,
  INCIDENT_TRIGGER_EVENTS,
  IncidentEntityStateSchema,
  deriveIncidentTriggerEvents,
  mirrorIncidentEntity,
  removeIncidentEntity,
  type IncidentEntityState,
} from "./incident-entity";

function change(overrides: Partial<EntityChanged> = {}): EntityChanged {
  return {
    kind: INCIDENT_ENTITY_KIND,
    id: "inc-1",
    prev: { status: "investigating", severity: "major", systemIds: ["a"] },
    next: { status: "monitoring", severity: "major", systemIds: ["a"] },
    delta: { status: "monitoring" },
    changedFields: ["status"],
    actor: SYSTEM_ACTOR,
    occurredAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("deriveIncidentTriggerEvents", () => {
  it("create → incident.created", () => {
    expect(
      deriveIncidentTriggerEvents(
        change({
          prev: null,
          next: { status: "investigating", severity: "minor", systemIds: ["a"] },
        }),
      ),
    ).toEqual([INCIDENT_TRIGGER_EVENTS.created]);
  });

  it("transition to resolved → incident.resolved", () => {
    expect(
      deriveIncidentTriggerEvents(
        change({
          prev: { status: "monitoring", severity: "major", systemIds: ["a"] },
          next: { status: "resolved", severity: "major", systemIds: ["a"] },
        }),
      ),
    ).toEqual([INCIDENT_TRIGGER_EVENTS.resolved]);
  });

  it("non-resolve field change → incident.updated", () => {
    expect(deriveIncidentTriggerEvents(change())).toEqual([
      INCIDENT_TRIGGER_EVENTS.updated,
    ]);
  });

  it("reopen (resolved → investigating) → incident.updated", () => {
    expect(
      deriveIncidentTriggerEvents(
        change({
          prev: { status: "resolved", severity: "major", systemIds: ["a"] },
          next: { status: "investigating", severity: "major", systemIds: ["a"] },
        }),
      ),
    ).toEqual([INCIDENT_TRIGGER_EVENTS.updated]);
  });

  it("tombstone → no event (no incident.deleted)", () => {
    expect(deriveIncidentTriggerEvents(change({ next: null }))).toEqual([]);
  });
});

describe("IncidentEntityStateSchema", () => {
  it("parses the reactive subset", () => {
    const parsed = IncidentEntityStateSchema.parse({
      status: "investigating",
      severity: "critical",
      systemIds: ["a", "b"],
    });
    expect(parsed.systemIds).toEqual(["a", "b"]);
  });
});

describe("incident mirror", () => {
  it("mirrors keyed by incident id", async () => {
    const calls: Array<{ id: string; next: IncidentEntityState }> = [];
    const handle = {
      kind: INCIDENT_ENTITY_KIND,
      async set(id: string, next: IncidentEntityState) {
        calls.push({ id, next });
      },
    } as unknown as EntityHandle<IncidentEntityState>;
    await mirrorIncidentEntity({
      handle,
      incidentId: "inc-9",
      status: "investigating",
      severity: "critical",
      systemIds: ["a"],
    });
    expect(calls).toEqual([
      {
        id: "inc-9",
        next: { status: "investigating", severity: "critical", systemIds: ["a"] },
      },
    ]);
  });

  it("removeIncidentEntity tombstones via remove()", async () => {
    const removed: string[] = [];
    const handle = {
      kind: INCIDENT_ENTITY_KIND,
      async remove(id: string) {
        removed.push(id);
      },
    } as unknown as EntityHandle<IncidentEntityState>;
    await removeIncidentEntity({ handle, incidentId: "inc-9" });
    expect(removed).toEqual(["inc-9"]);
  });

  it("no-ops without a handle and routes errors", async () => {
    await mirrorIncidentEntity({
      handle: undefined,
      incidentId: "x",
      status: "investigating",
      severity: "minor",
      systemIds: [],
    });
    let captured: unknown;
    const handle = {
      kind: INCIDENT_ENTITY_KIND,
      async set() {
        throw new Error("boom");
      },
    } as unknown as EntityHandle<IncidentEntityState>;
    await mirrorIncidentEntity({
      handle,
      incidentId: "x",
      status: "investigating",
      severity: "minor",
      systemIds: [],
      onError: (e) => {
        captured = e;
      },
    });
    expect((captured as Error).message).toBe("boom");
  });
});
