import { describe, it, expect } from "bun:test";
import { SYSTEM_ACTOR } from "@checkstack/common";
import { buildInitialScope } from "./scope";

describe("buildInitialScope — trigger.actor", () => {
  const base = {
    triggerId: "t1",
    triggerEventId: "incident.created",
    payload: { incidentId: "i1" },
    startedAt: new Date("2026-05-30T00:00:00.000Z"),
  };

  it("defaults trigger.actor to the system actor when none is supplied", () => {
    const scope = buildInitialScope(base);
    const trigger = scope.trigger as { actor: unknown };
    expect(trigger.actor).toEqual(SYSTEM_ACTOR);
  });

  it("exposes the supplied actor under trigger.actor alongside the payload", () => {
    const actor = { type: "user", id: "user-1", name: "Nico" } as const;
    const scope = buildInitialScope({ ...base, actor });
    const trigger = scope.trigger as { actor: unknown; payload: unknown };
    expect(trigger.actor).toEqual(actor);
    expect(trigger.payload).toEqual({ incidentId: "i1" });
  });

  it("exposes trigger.id and the canonical trigger.event (with eventId alias)", () => {
    const scope = buildInitialScope(base);
    const trigger = scope.trigger as {
      id: unknown;
      event: unknown;
      eventId: unknown;
    };
    expect(trigger.id).toBe("t1");
    // `event` is canonical (matches the editor + script contract); `eventId`
    // stays as a back-compat alias.
    expect(trigger.event).toBe("incident.created");
    expect(trigger.eventId).toBe("incident.created");
  });
});
