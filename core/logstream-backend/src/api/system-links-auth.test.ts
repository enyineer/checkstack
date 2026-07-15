import { describe, it, expect } from "bun:test";
import { findUnreadableSystemIds } from "./system-links-auth";

describe("findUnreadableSystemIds (membership pass)", () => {
  it("returns the added ids absent from the readable set, in input order", () => {
    expect(
      findUnreadableSystemIds({
        addedSystemIds: ["b", "a", "c"],
        readableSystemIds: ["a"],
      }),
    ).toEqual(["b", "c"]);
  });

  it("returns empty when every added id is readable", () => {
    expect(
      findUnreadableSystemIds({
        addedSystemIds: ["a", "b"],
        readableSystemIds: ["a", "b", "c"],
      }),
    ).toEqual([]);
  });

  it("treats an empty readable set as everything unreadable", () => {
    expect(
      findUnreadableSystemIds({
        addedSystemIds: ["a", "b"],
        readableSystemIds: [],
      }),
    ).toEqual(["a", "b"]);
  });
});
