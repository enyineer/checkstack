import { describe, it, expect } from "bun:test";
import { diffEntityState } from "./diff";

describe("diffEntityState", () => {
  it("reports added fields on create (prev null)", () => {
    const { changedFields, delta } = diffEntityState({
      prev: null,
      next: { status: "open", severity: "high" },
    });
    expect(changedFields).toEqual(["severity", "status"]);
    expect(delta).toEqual({ status: "open", severity: "high" });
  });

  it("reports only the changed field on a value change", () => {
    const { changedFields, delta } = diffEntityState({
      prev: { status: "open", severity: "high" },
      next: { status: "resolved", severity: "high" },
    });
    expect(changedFields).toEqual(["status"]);
    expect(delta).toEqual({ status: "resolved" });
  });

  it("reports a dropped field as null in the delta", () => {
    const { changedFields, delta } = diffEntityState({
      prev: { status: "open", note: "x" },
      next: { status: "open" },
    });
    expect(changedFields).toEqual(["note"]);
    expect(delta).toEqual({ note: null });
  });

  it("returns empty when structurally unchanged (key order, nesting)", () => {
    const { changedFields, delta } = diffEntityState({
      prev: { a: 1, nested: { x: 1, y: 2 } },
      next: { nested: { y: 2, x: 1 }, a: 1 },
    });
    expect(changedFields).toEqual([]);
    expect(delta).toEqual({});
  });

  it("detects nested object changes", () => {
    const { changedFields, delta } = diffEntityState({
      prev: { window: { startAt: "1", endAt: "2" } },
      next: { window: { startAt: "1", endAt: "3" } },
    });
    expect(changedFields).toEqual(["window"]);
    expect(delta).toEqual({ window: { startAt: "1", endAt: "3" } });
  });

  it("detects array changes", () => {
    const { changedFields } = diffEntityState({
      prev: { systemIds: ["a", "b"] },
      next: { systemIds: ["a", "b", "c"] },
    });
    expect(changedFields).toEqual(["systemIds"]);
  });
});
