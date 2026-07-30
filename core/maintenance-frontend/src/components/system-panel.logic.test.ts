import { describe, expect, test } from "bun:test";
import {
  summariseMaintenancePanel,
  type PanelMaintenance,
} from "./system-panel.logic";

const window_ = (
  id: string,
  status: PanelMaintenance["status"],
): PanelMaintenance => ({ id, title: `Window ${id}`, status });

describe("summariseMaintenancePanel", () => {
  test("a single scheduled window is named rather than counted", () => {
    const summary = summariseMaintenancePanel({
      maintenances: [window_("a", "scheduled")],
    });

    expect(summary.soleLead?.id).toBe("a");
    expect(summary.leadStatus).toBe("scheduled");
    expect(summary.leadCaption).toBe("scheduled");
  });

  test("a single in-progress window is named rather than counted", () => {
    const summary = summariseMaintenancePanel({
      maintenances: [window_("a", "in_progress")],
    });

    expect(summary.soleLead?.id).toBe("a");
    expect(summary.leadStatus).toBe("in_progress");
    expect(summary.leadCaption).toBe("in progress");
  });

  test("two leading windows fall back to a count, with no sole lead", () => {
    const summary = summariseMaintenancePanel({
      maintenances: [window_("a", "scheduled"), window_("b", "scheduled")],
    });

    expect(summary.soleLead).toBeUndefined();
    expect(summary.lead).toHaveLength(2);
  });

  test("a running window outranks scheduled ones for the lead", () => {
    const summary = summariseMaintenancePanel({
      maintenances: [
        window_("s1", "scheduled"),
        window_("a", "in_progress"),
        window_("s2", "scheduled"),
      ],
    });

    expect(summary.leadStatus).toBe("in_progress");
    expect(summary.soleLead?.id).toBe("a");
    // The scheduled ones become the trailing "+ N scheduled" note.
    expect(summary.trailingScheduled.map((m) => m.id)).toEqual(["s1", "s2"]);
  });

  test("scheduled windows only trail when something is actually running", () => {
    const summary = summariseMaintenancePanel({
      maintenances: [window_("s1", "scheduled"), window_("s2", "scheduled")],
    });

    // They ARE the lead here, so counting them again as trailing would
    // double-report them on the card.
    expect(summary.trailingScheduled).toEqual([]);
  });

  test("ignores windows in neither leading state", () => {
    const summary = summariseMaintenancePanel({
      maintenances: [window_("done", "completed"), window_("a", "scheduled")],
    });

    expect(summary.soleLead?.id).toBe("a");
    expect(summary.lead).toHaveLength(1);
  });

  test("an empty list yields no lead at all", () => {
    const summary = summariseMaintenancePanel({ maintenances: [] });

    expect(summary.lead).toEqual([]);
    expect(summary.soleLead).toBeUndefined();
    // With nothing running, the card would read as upcoming.
    expect(summary.leadStatus).toBe("scheduled");
  });
});
