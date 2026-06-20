import { describe, expect, test } from "bun:test";
import {
  derivedStateTone,
  impactTypeTone,
  ownStatusTone,
  toneStyles,
} from "./statusPill.logic";

describe("ownStatusTone", () => {
  test("maps down-like values to down", () => {
    for (const v of ["down", "DOWN", "critical", "error", "unhealthy"]) {
      expect(ownStatusTone({ ownStatus: v })).toBe("down");
    }
  });

  test("maps degraded-like values to warn", () => {
    for (const v of ["degraded", "warn", "Warning"]) {
      expect(ownStatusTone({ ownStatus: v })).toBe("warn");
    }
  });

  test("maps healthy-like values to ok", () => {
    for (const v of ["operational", "ok", "Healthy", "up"]) {
      expect(ownStatusTone({ ownStatus: v })).toBe("ok");
    }
  });

  test("falls back to neutral for unknown values", () => {
    expect(ownStatusTone({ ownStatus: "pending" })).toBe("neutral");
    expect(ownStatusTone({ ownStatus: "" })).toBe("neutral");
  });
});

describe("derivedStateTone", () => {
  test("down -> down, degraded -> warn, info -> neutral", () => {
    expect(derivedStateTone({ state: "down" })).toBe("down");
    expect(derivedStateTone({ state: "degraded" })).toBe("warn");
    expect(derivedStateTone({ state: "info" })).toBe("neutral");
  });
});

describe("impactTypeTone", () => {
  test("critical -> down, degraded -> warn, informational -> neutral", () => {
    expect(impactTypeTone({ impactType: "critical" })).toBe("down");
    expect(impactTypeTone({ impactType: "degraded" })).toBe("warn");
    expect(impactTypeTone({ impactType: "informational" })).toBe("neutral");
  });
});

describe("toneStyles", () => {
  test("exposes a class set for every tone", () => {
    for (const tone of ["ok", "warn", "down", "neutral"] as const) {
      expect(toneStyles[tone].pill).toBeTruthy();
      expect(toneStyles[tone].dot).toBeTruthy();
      expect(toneStyles[tone].accent).toBeTruthy();
    }
  });
});
