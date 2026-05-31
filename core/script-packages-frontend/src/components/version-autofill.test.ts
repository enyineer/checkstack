import { describe, expect, test } from "bun:test";
import { applyLatestDistTag, versionFromHit } from "./version-autofill";

describe("versionFromHit", () => {
  test("uses the hit's version when present", () => {
    expect(versionFromHit({ version: "4.17.21" })).toBe("4.17.21");
  });

  test("falls back to empty when the hit has no version", () => {
    expect(versionFromHit({})).toBe("");
  });
});

describe("applyLatestDistTag", () => {
  test("fills latest when the field is empty", () => {
    expect(applyLatestDistTag({ current: "", latest: "5.0.0" })).toBe("5.0.0");
  });

  test("fills latest when the field is whitespace-only", () => {
    expect(applyLatestDistTag({ current: "   ", latest: "5.0.0" })).toBe(
      "5.0.0",
    );
  });

  test("does NOT clobber a value already seeded from the hit", () => {
    expect(applyLatestDistTag({ current: "4.17.21", latest: "5.0.0" })).toBe(
      "4.17.21",
    );
  });

  test("does NOT clobber a manually-typed pin", () => {
    expect(applyLatestDistTag({ current: "1.2.3", latest: "5.0.0" })).toBe(
      "1.2.3",
    );
  });

  test("keeps current unchanged when there is no latest tag", () => {
    expect(applyLatestDistTag({ current: "", latest: undefined })).toBe("");
    expect(applyLatestDistTag({ current: "1.0.0", latest: undefined })).toBe(
      "1.0.0",
    );
  });
});
