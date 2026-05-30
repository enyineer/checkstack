import { describe, it, expect } from "bun:test";
import type { Trigger } from "@checkstack/automation-common";
import {
  assignDefaultTriggerIds,
  collectTriggerIds,
  defaultTriggerId,
} from "./trigger-helpers";

describe("trigger-helpers", () => {
  it("derives a default id from the event when none is set", () => {
    expect(defaultTriggerId({ event: "incident.created" }, new Set())).toBe(
      "incident_created",
    );
  });

  it("dedupes against taken ids with numeric suffixes", () => {
    const trigger: Trigger = { event: "incident.created" };
    expect(defaultTriggerId(trigger, new Set(["incident_created"]))).toBe(
      "incident_created_2",
    );
    expect(
      defaultTriggerId(
        trigger,
        new Set(["incident_created", "incident_created_2"]),
      ),
    ).toBe("incident_created_3");
  });

  it("collects only non-empty ids", () => {
    const triggers: Trigger[] = [
      { event: "a", id: "x" },
      { event: "b" },
      { event: "c", id: "" },
    ];
    expect([...collectTriggerIds(triggers)]).toEqual(["x"]);
  });

  it("assigns unique ids to triggers missing them, preserving existing", () => {
    const out = assignDefaultTriggerIds([
      { event: "incident.created", id: "primary" },
      { event: "incident.created" },
      { event: "maintenance.created" },
    ]);
    expect(out[0]!.id).toBe("primary");
    expect(out[1]!.id).toBe("incident_created");
    expect(out[2]!.id).toBe("maintenance_created");
    expect(new Set(out.map((t) => t.id)).size).toBe(3);
  });

  it("makes two triggers on the same event distinguishable", () => {
    const out = assignDefaultTriggerIds([
      { event: "incident.created" },
      { event: "incident.created" },
    ]);
    expect(out[0]!.id).toBe("incident_created");
    expect(out[1]!.id).toBe("incident_created_2");
  });
});
