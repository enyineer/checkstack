import { describe, expect, test } from "bun:test";
import {
  validateSloForm,
  deriveSloFieldErrors,
  isSloFormValid,
} from "./sloEditor.logic";

const VALID = {
  systemId: "s-1",
  target: "99.9",
  windowDays: "30",
  warningPercent: "50",
  criticalPercent: "80",
};

describe("validateSloForm", () => {
  test("parses a fully valid form", () => {
    const result = validateSloForm(VALID);
    expect(result).toEqual({
      ok: true,
      value: {
        target: 99.9,
        windowDays: 30,
        warningPercent: 50,
        criticalPercent: 80,
      },
    });
  });

  test("requires a selected system", () => {
    const result = validateSloForm({ ...VALID, systemId: "" });
    expect(result).toEqual({ ok: false, error: "Please select a system" });
  });

  test("rejects a non-numeric target", () => {
    const result = validateSloForm({ ...VALID, target: "abc" });
    expect(result).toEqual({
      ok: false,
      error: "Target must be between 0 and 100",
    });
  });

  test("rejects targets outside 0..100", () => {
    expect(validateSloForm({ ...VALID, target: "-1" }).ok).toBe(false);
    expect(validateSloForm({ ...VALID, target: "100.1" }).ok).toBe(false);
  });

  test("accepts the inclusive target bounds", () => {
    expect(validateSloForm({ ...VALID, target: "0" }).ok).toBe(true);
    expect(validateSloForm({ ...VALID, target: "100" }).ok).toBe(true);
  });

  test("rejects a window under one day", () => {
    const result = validateSloForm({ ...VALID, windowDays: "0" });
    expect(result).toEqual({
      ok: false,
      error: "Window must be at least 1 day",
    });
  });

  test("rejects a non-numeric window", () => {
    expect(validateSloForm({ ...VALID, windowDays: "" }).ok).toBe(false);
  });

  test("window is parsed as an integer (truncating)", () => {
    const result = validateSloForm({ ...VALID, windowDays: "14.9" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.windowDays).toBe(14);
  });

  test("system check precedes the target check", () => {
    const result = validateSloForm({
      ...VALID,
      systemId: "",
      target: "999",
    });
    expect(result).toEqual({ ok: false, error: "Please select a system" });
  });
});

describe("deriveSloFieldErrors", () => {
  test("returns an empty map for a fully valid form", () => {
    expect(deriveSloFieldErrors(VALID)).toEqual({});
  });

  test("reports every invalid field at once (no short-circuit)", () => {
    const errors = deriveSloFieldErrors({
      systemId: "",
      target: "abc",
      windowDays: "0",
      warningPercent: "200",
      criticalPercent: "-5",
    });
    expect(errors).toEqual({
      systemId: "Please select a system",
      target: "Target must be between 0 and 100",
      windowDays: "Window must be at least 1 day",
      warningPercent: "Warning threshold must be between 0 and 100",
      criticalPercent: "Critical threshold must be between 0 and 100",
    });
  });

  test("flags a missing system", () => {
    expect(deriveSloFieldErrors({ ...VALID, systemId: "" })).toEqual({
      systemId: "Please select a system",
    });
  });

  test("flags an out-of-range or non-numeric target", () => {
    expect(deriveSloFieldErrors({ ...VALID, target: "100.1" }).target).toBe(
      "Target must be between 0 and 100",
    );
    expect(deriveSloFieldErrors({ ...VALID, target: "abc" }).target).toBe(
      "Target must be between 0 and 100",
    );
  });

  test("accepts inclusive target bounds", () => {
    expect(deriveSloFieldErrors({ ...VALID, target: "0" }).target).toBeUndefined();
    expect(
      deriveSloFieldErrors({ ...VALID, target: "100" }).target,
    ).toBeUndefined();
  });

  test("flags a sub-one-day window", () => {
    expect(deriveSloFieldErrors({ ...VALID, windowDays: "0" }).windowDays).toBe(
      "Window must be at least 1 day",
    );
    expect(deriveSloFieldErrors({ ...VALID, windowDays: "" }).windowDays).toBe(
      "Window must be at least 1 day",
    );
  });

  test("range-checks burn-rate thresholds to [0, 100]", () => {
    expect(
      deriveSloFieldErrors({ ...VALID, warningPercent: "101" }).warningPercent,
    ).toBe("Warning threshold must be between 0 and 100");
    expect(
      deriveSloFieldErrors({ ...VALID, criticalPercent: "-1" }).criticalPercent,
    ).toBe("Critical threshold must be between 0 and 100");
    expect(
      deriveSloFieldErrors({ ...VALID, warningPercent: "0", criticalPercent: "100" }),
    ).toEqual({});
  });
});

describe("isSloFormValid", () => {
  test("true only when the error map is empty", () => {
    expect(isSloFormValid({})).toBe(true);
    expect(isSloFormValid({ systemId: "Please select a system" })).toBe(false);
  });
});
