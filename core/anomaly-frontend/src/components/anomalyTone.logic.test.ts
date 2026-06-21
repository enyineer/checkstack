import { describe, expect, it } from "bun:test";
import {
  anomalyToneStyles,
  toneForState,
  widgetTone,
} from "./anomalyTone.logic";

describe("toneForState", () => {
  it("maps suspicious to unknown", () => {
    expect(toneForState("suspicious")).toBe("unknown");
  });

  it("maps confirmed (anomaly) to warn", () => {
    expect(toneForState("anomaly")).toBe("warn");
    expect(toneForState("confirmed")).toBe("warn");
  });
});

describe("widgetTone", () => {
  it("is warn when any confirmed anomaly is present", () => {
    expect(widgetTone({ confirmedCount: 1 })).toBe("warn");
    expect(widgetTone({ confirmedCount: 5 })).toBe("warn");
  });

  it("falls back to unknown when only suspicious rows exist", () => {
    expect(widgetTone({ confirmedCount: 0 })).toBe("unknown");
  });
});

describe("anomalyToneStyles", () => {
  it("returns the warn triad classes", () => {
    const styles = anomalyToneStyles("warn");
    expect(styles.accent).toContain("bg-status-warn");
    expect(styles.pill).toContain("text-status-warn");
    expect(styles.dot).toBe("bg-status-warn");
  });

  it("returns the unknown triad classes", () => {
    const styles = anomalyToneStyles("unknown");
    expect(styles.accent).toContain("bg-status-unknown");
    expect(styles.pill).toContain("text-status-unknown");
    expect(styles.dot).toBe("bg-status-unknown");
  });
});
