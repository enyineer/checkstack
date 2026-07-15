import { describe, it, expect } from "bun:test";
import {
  systemIdSetsEqual,
  isLinksDraftDirty,
} from "./stream-system-links-card.logic";

describe("systemIdSetsEqual", () => {
  it("is true for the same ids in any order", () => {
    expect(systemIdSetsEqual(["a", "b", "c"], ["c", "a", "b"])).toBe(true);
  });

  it("is true for two empty sets", () => {
    expect(systemIdSetsEqual([], [])).toBe(true);
  });

  it("is false when sizes differ", () => {
    expect(systemIdSetsEqual(["a"], ["a", "b"])).toBe(false);
  });

  it("is false when an id differs", () => {
    expect(systemIdSetsEqual(["a", "b"], ["a", "c"])).toBe(false);
  });

  it("ignores duplicate ids", () => {
    expect(systemIdSetsEqual(["a", "a", "b"], ["a", "b"])).toBe(true);
  });
});

describe("isLinksDraftDirty", () => {
  it("is not dirty while saved is still loading", () => {
    expect(isLinksDraftDirty({ draft: ["a"], saved: undefined })).toBe(false);
  });

  it("is not dirty when draft equals saved (order-insensitive)", () => {
    expect(isLinksDraftDirty({ draft: ["a", "b"], saved: ["b", "a"] })).toBe(
      false,
    );
  });

  it("is dirty when a system is added", () => {
    expect(isLinksDraftDirty({ draft: ["a", "b"], saved: ["a"] })).toBe(true);
  });

  it("is dirty when a system is removed", () => {
    expect(isLinksDraftDirty({ draft: [], saved: ["a"] })).toBe(true);
  });
});
