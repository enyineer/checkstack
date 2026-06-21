import { describe, expect, it } from "bun:test";
import { EVENT_TONE_STYLES, eventTone } from "./eventDisplay.logic";

describe("eventTone", () => {
  it("maps succeeded to the ok tone", () => {
    expect(eventTone({ status: "succeeded" })).toBe("ok");
  });

  it("maps failed to the down tone", () => {
    expect(eventTone({ status: "failed" })).toBe("down");
  });

  it("maps an in-flight started event to the unknown tone", () => {
    expect(eventTone({ status: "started" })).toBe("unknown");
  });

  it("maps every tone to a defined class set", () => {
    for (const tone of ["ok", "down", "unknown"] as const) {
      expect(EVENT_TONE_STYLES[tone].pill).toContain(`status-${tone}`);
      expect(EVENT_TONE_STYLES[tone].dot).toContain(`status-${tone}`);
      expect(EVENT_TONE_STYLES[tone].accent).toContain(`status-${tone}`);
    }
  });
});
