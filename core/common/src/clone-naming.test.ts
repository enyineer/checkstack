import { describe, expect, test } from "bun:test";
import { CLONE_NAME_SUFFIX, buildClonedName } from "./clone-naming";

describe("buildClonedName", () => {
  test("appends the suffix", () => {
    expect(buildClonedName({ name: "Payments API" })).toBe(
      "Payments API (copy)",
    );
  });

  test("appends again when cloning a clone, so two copies never collide", () => {
    expect(buildClonedName({ name: "Developer (copy)" })).toBe(
      "Developer (copy) (copy)",
    );
  });

  test("trims the source name so the suffix is never double-spaced", () => {
    expect(buildClonedName({ name: "Staging  " })).toBe("Staging (copy)");
  });

  test("handles an empty name without producing a leading space", () => {
    expect(buildClonedName({ name: "" })).toBe(CLONE_NAME_SUFFIX);
  });
});
