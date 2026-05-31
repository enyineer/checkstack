import { describe, it, expect } from "bun:test";
import type { Trigger } from "@checkstack/automation-common";
import {
  assignDefaultTriggerIds,
  collectTriggerIds,
  defaultTriggerId,
  makeTrigger,
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

  // The trigger type picker builds a trigger via `makeTrigger`; it must carry
  // the picked event and a default id that is unique against existing siblings.
  it("makeTrigger sets the picked event and a derived default id", () => {
    expect(makeTrigger({ event: "incident.created", taken: new Set() })).toEqual(
      { event: "incident.created", id: "incident_created" },
    );
  });

  it("makeTrigger dedupes its default id against existing trigger ids", () => {
    const out = makeTrigger({
      event: "incident.created",
      taken: new Set(["incident_created"]),
    });
    expect(out.event).toBe("incident.created");
    expect(out.id).toBe("incident_created_2");
  });

  // Regression for the editor-load fix: a stored/seeded definition (e.g. the
  // "Auto-incident: ... flapping" seed) whose trigger carries no `id` must be
  // materialized to its derived id on load, so the Id field shows it without
  // the operator focusing + blurring the input first.
  it("materializes the derived id for an id-less seeded trigger on load", () => {
    const stored: Trigger[] = [{ event: "healthcheck.flapping_detected" }];
    const out = assignDefaultTriggerIds(stored);
    expect(out[0]!.id).toBe("healthcheck_flapping_detected");
  });
});
