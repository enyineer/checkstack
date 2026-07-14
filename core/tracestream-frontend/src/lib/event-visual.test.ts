import { describe, expect, it } from "bun:test";
import { TRACE_IMPORTANT_EVENT_TYPES } from "@checkstack/tracestream-common";
import { importantEventVisual } from "./event-visual";

describe("importantEventVisual", () => {
  it("returns a visual with an icon, tone and label for every event type", () => {
    for (const type of TRACE_IMPORTANT_EVENT_TYPES) {
      const visual = importantEventVisual(type);
      expect(visual.icon).toBeDefined();
      expect(visual.label.length).toBeGreaterThan(0);
      expect(["ok", "warn", "error", "info", "neutral"]).toContain(visual.tone);
    }
  });

  it("maps recovery to the ok tone and silence to warn", () => {
    expect(importantEventVisual("silence_recovered").tone).toBe("ok");
    expect(importantEventVisual("silence").tone).toBe("warn");
  });

  it("tones an error spike as error, matching the logstream spike visual", () => {
    const visual = importantEventVisual("error_spike");
    expect(visual.tone).toBe("error");
    expect(visual.label).toBe("Error spike");
  });
});
