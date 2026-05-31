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
  createIncidentEntityRead,
  deriveIncidentTriggerEvents,
  incidentChangeToPayload,
  removeIncidentEntity,
  toIncidentEntityState,
  writeIncidentEntity,
  type IncidentEntityState,
} from "./incident-entity";
import {
  incidentCreatedTrigger,
  incidentResolvedTrigger,
  incidentUpdatedTrigger,
} from "./automations";
import type { IncidentService } from "./service";

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

describe("incidentChangeToPayload — payloadSchema parity", () => {
  it("a create payload validates against the created trigger's payloadSchema", () => {
    const payload = incidentChangeToPayload(
      change({
        prev: null,
        next: { status: "investigating", severity: "minor", systemIds: ["a", "b"] },
        delta: { status: "investigating" },
        changedFields: ["status", "severity", "systemIds"],
      }),
    );
    const parsed = incidentCreatedTrigger.payloadSchema.parse(payload);
    expect(parsed.incidentId).toBe("inc-1");
    expect(parsed.status).toBe("investigating");
    expect(parsed.severity).toBe("minor");
    expect(parsed.systemIds).toEqual(["a", "b"]);
  });

  it("a status-flip payload validates against the updated trigger's payloadSchema and carries statusChange", () => {
    const payload = incidentChangeToPayload(change());
    const parsed = incidentUpdatedTrigger.payloadSchema.parse(payload);
    expect(parsed.incidentId).toBe("inc-1");
    expect(parsed.status).toBe("monitoring");
    // status was in changedFields → statusChange mirrors the new status.
    expect(parsed.statusChange).toBe("monitoring");
  });

  it("a resolve payload validates against the resolved trigger's payloadSchema", () => {
    const payload = incidentChangeToPayload(
      change({
        prev: { status: "monitoring", severity: "major", systemIds: ["a"] },
        next: { status: "resolved", severity: "major", systemIds: ["a"] },
      }),
    );
    const parsed = incidentResolvedTrigger.payloadSchema.parse(payload);
    expect(parsed.incidentId).toBe("inc-1");
    expect(parsed.severity).toBe("major");
    expect(parsed.systemIds).toEqual(["a"]);
  });

  it("omits statusChange when status did not change", () => {
    const payload = incidentChangeToPayload(
      change({
        delta: { severity: "critical" },
        changedFields: ["severity"],
        next: { status: "monitoring", severity: "critical", systemIds: ["a"] },
      }),
    );
    expect("statusChange" in payload).toBe(false);
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

describe("toIncidentEntityState", () => {
  it("projects the reactive subset off a full incident", () => {
    expect(
      toIncidentEntityState({
        status: "monitoring",
        severity: "major",
        systemIds: ["a", "b"],
      }),
    ).toEqual({ status: "monitoring", severity: "major", systemIds: ["a", "b"] });
  });
});

describe("createIncidentEntityRead", () => {
  it("routes the batched read straight to the service (plugin-backed)", async () => {
    const seen: ReadonlyArray<string>[] = [];
    const service = {
      async getManyEntityStates(ids: ReadonlyArray<string>) {
        seen.push(ids);
        return {
          "inc-1": {
            status: "investigating" as const,
            severity: "minor" as const,
            systemIds: ["a"],
          },
        };
      },
    } as unknown as IncidentService;
    const read = createIncidentEntityRead(service);
    const out = await read(["inc-1", "inc-2"]);
    expect(seen).toEqual([["inc-1", "inc-2"]]);
    expect(out["inc-1"]).toEqual({
      status: "investigating",
      severity: "minor",
      systemIds: ["a"],
    });
  });
});

describe("writeIncidentEntity", () => {
  it("drives the write through handle.mutate keyed by incident id", async () => {
    const calls: Array<{ id: string; next: IncidentEntityState }> = [];
    const handle = {
      kind: INCIDENT_ENTITY_KIND,
      async mutate(input: {
        id: string;
        apply: () => Promise<IncidentEntityState>;
      }) {
        const next = await input.apply();
        calls.push({ id: input.id, next });
        return next;
      },
    } as unknown as EntityHandle<IncidentEntityState>;

    let applied = false;
    await writeIncidentEntity({
      handle,
      incidentId: "inc-9",
      apply: async () => {
        applied = true;
        return { status: "monitoring", severity: "critical", systemIds: ["a"] };
      },
    });
    expect(applied).toBe(true);
    expect(calls).toEqual([
      {
        id: "inc-9",
        next: { status: "monitoring", severity: "critical", systemIds: ["a"] },
      },
    ]);
  });

  it("still runs the plugin write when no handle is wired", async () => {
    let applied = false;
    await writeIncidentEntity({
      handle: undefined,
      incidentId: "inc-9",
      apply: async () => {
        applied = true;
        return { status: "investigating", severity: "minor", systemIds: [] };
      },
    });
    expect(applied).toBe(true);
  });
});

describe("removeIncidentEntity", () => {
  it("tombstones via handle.remove({ apply })", async () => {
    const removed: string[] = [];
    let deleted = false;
    const handle = {
      kind: INCIDENT_ENTITY_KIND,
      async remove(input: { id: string; apply: () => Promise<void> }) {
        await input.apply();
        removed.push(input.id);
      },
    } as unknown as EntityHandle<IncidentEntityState>;
    await removeIncidentEntity({
      handle,
      incidentId: "inc-9",
      apply: async () => {
        deleted = true;
      },
    });
    expect(deleted).toBe(true);
    expect(removed).toEqual(["inc-9"]);
  });

  it("still runs the delete when no handle is wired", async () => {
    let deleted = false;
    await removeIncidentEntity({
      handle: undefined,
      incidentId: "inc-9",
      apply: async () => {
        deleted = true;
      },
    });
    expect(deleted).toBe(true);
  });
});
