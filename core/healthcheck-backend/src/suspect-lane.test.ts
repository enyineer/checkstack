import { describe, expect, test } from "bun:test";
import { SuspectLane } from "./suspect-lane";

describe("SuspectLane", () => {
  test("admits up to capacity, then denies with lane_full", () => {
    const lane = new SuspectLane(2);
    expect(lane.tryAdmit("a")).toEqual({ admitted: true });
    expect(lane.tryAdmit("b")).toEqual({ admitted: true });
    expect(lane.active).toBe(2);
    expect(lane.tryAdmit("c")).toEqual({ admitted: false, reason: "lane_full" });
  });

  test("single-flight: a second admit of the same key is denied with in_flight", () => {
    const lane = new SuspectLane(4);
    expect(lane.tryAdmit("k")).toEqual({ admitted: true });
    expect(lane.tryAdmit("k")).toEqual({ admitted: false, reason: "in_flight" });
    expect(lane.active).toBe(1); // the duplicate did not consume a slot
  });

  test("in_flight is checked before capacity", () => {
    const lane = new SuspectLane(1);
    expect(lane.tryAdmit("k")).toEqual({ admitted: true });
    // lane is full AND k is in-flight; in_flight wins (more specific reason).
    expect(lane.tryAdmit("k")).toEqual({ admitted: false, reason: "in_flight" });
  });

  test("release frees the slot and clears single-flight", () => {
    const lane = new SuspectLane(1);
    expect(lane.tryAdmit("k")).toEqual({ admitted: true });
    expect(lane.tryAdmit("k")).toEqual({ admitted: false, reason: "in_flight" });
    lane.release("k");
    expect(lane.active).toBe(0);
    expect(lane.tryAdmit("k")).toEqual({ admitted: true }); // re-admittable
  });

  test("release is idempotent for unknown/duplicate keys", () => {
    const lane = new SuspectLane(2);
    lane.tryAdmit("a");
    lane.release("a");
    lane.release("a"); // no-op
    lane.release("never-admitted"); // no-op
    expect(lane.active).toBe(0);
    expect(lane.tryAdmit("a")).toEqual({ admitted: true });
  });

  test("rejects a non-positive capacity", () => {
    expect(() => new SuspectLane(0)).toThrow();
    expect(() => new SuspectLane(-1)).toThrow();
  });
});
