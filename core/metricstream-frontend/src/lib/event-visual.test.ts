import { describe, it, expect } from "bun:test";
import { IMPORTANT_EVENT_TYPES } from "@checkstack/metricstream-common";
import { importantEventVisual } from "./event-visual";

describe("importantEventVisual", () => {
  it("maps each event type to a tone + label", () => {
    expect(importantEventVisual("series_cap").tone).toBe("warn");
    expect(importantEventVisual("series_cap").label).toBe("Series cap reached");
    expect(importantEventVisual("scrape_failing").tone).toBe("error");
    expect(importantEventVisual("silence").tone).toBe("warn");
    expect(importantEventVisual("silence_recovered").tone).toBe("ok");
  });

  it("has a visual for EVERY declared event type (no fall-through)", () => {
    for (const type of IMPORTANT_EVENT_TYPES) {
      const visual = importantEventVisual(type);
      expect(visual.icon).toBeDefined();
      expect(visual.label.length).toBeGreaterThan(0);
    }
  });
});
