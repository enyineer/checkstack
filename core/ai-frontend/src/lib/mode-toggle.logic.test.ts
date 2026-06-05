import { describe, expect, test } from "bun:test";
import {
  PERMISSION_MODE_OPTIONS,
  buildModeUpdate,
  deriveModeToggleValue,
} from "./mode-toggle.logic";

describe("deriveModeToggleValue", () => {
  test("uses the conversation's mode when valid", () => {
    expect(deriveModeToggleValue({ conversationMode: "auto" })).toBe("auto");
    expect(deriveModeToggleValue({ conversationMode: "approve" })).toBe(
      "approve",
    );
  });

  test("falls back to the safe default (approve) for null/undefined/invalid", () => {
    expect(deriveModeToggleValue({ conversationMode: null })).toBe("approve");
    expect(deriveModeToggleValue({ conversationMode: undefined })).toBe(
      "approve",
    );
    expect(deriveModeToggleValue({ conversationMode: "bogus" })).toBe("approve");
  });
});

describe("buildModeUpdate", () => {
  test("returns the owner-scoped update payload on a real change", () => {
    expect(
      buildModeUpdate({
        conversationId: "c1",
        currentMode: "approve",
        nextMode: "auto",
      }),
    ).toEqual({ id: "c1", permissionMode: "auto" });
  });

  test("returns undefined when there is no conversation to update", () => {
    expect(
      buildModeUpdate({
        conversationId: undefined,
        currentMode: "approve",
        nextMode: "auto",
      }),
    ).toBeUndefined();
  });

  test("returns undefined for a no-op (mode unchanged)", () => {
    expect(
      buildModeUpdate({
        conversationId: "c1",
        currentMode: "auto",
        nextMode: "auto",
      }),
    ).toBeUndefined();
  });
});

describe("PERMISSION_MODE_OPTIONS", () => {
  test("offers exactly approve + auto, in that order", () => {
    expect(PERMISSION_MODE_OPTIONS.map((o) => o.value)).toEqual([
      "approve",
      "auto",
    ]);
  });
});
