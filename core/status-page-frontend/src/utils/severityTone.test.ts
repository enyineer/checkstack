import { describe, expect, it } from "bun:test";
import {
  severityTone,
  severityPillClass,
  severityStripeClass,
} from "./severityTone";

describe("severityTone", () => {
  it("maps each incident severity to its canonical tone (matching badges.logic)", () => {
    expect(severityTone("critical")).toBe("down");
    expect(severityTone("major")).toBe("warn");
    expect(severityTone("minor")).toBe("info");
  });

  it("does NOT render minor as the neutral grey 'unknown' tone (regression)", () => {
    expect(severityTone("minor")).not.toBe("unknown");
    expect(severityPillClass("minor")).not.toContain("bg-status-unknown");
    expect(severityStripeClass("minor")).not.toContain("bg-status-unknown");
  });

  it("uses the blue info hue for minor pills and stripes", () => {
    expect(severityPillClass("minor")).toBe("bg-status-info/10 text-status-info");
    expect(severityStripeClass("minor")).toBe("bg-status-info");
  });

  it("falls back to the grey unknown tone for unrecognized severities", () => {
    expect(severityTone("weird")).toBe("unknown");
    expect(severityStripeClass("weird")).toBe("bg-status-unknown");
  });
});
