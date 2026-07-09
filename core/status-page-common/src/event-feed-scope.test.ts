import { describe, it, expect } from "bun:test";
import { resolveEventFeedScope } from "./event-feed-scope";

describe("resolveEventFeedScope", () => {
  const groupMembers = new Map<string, string[]>([
    ["g1", ["s1", "s2", "s3"]],
    ["g2", ["s4"]],
  ]);

  it("unions explicit systems with group members", () => {
    const scope = resolveEventFeedScope({
      systemIds: ["s9"],
      groupIds: ["g1"],
      excludedSystemIds: [],
      groupMembers,
    });
    expect([...scope].sort()).toEqual(["s1", "s2", "s3", "s9"]);
  });

  it("subtracts excluded systems (from both explicit and group)", () => {
    const scope = resolveEventFeedScope({
      systemIds: ["s9"],
      groupIds: ["g1"],
      excludedSystemIds: ["s2", "s9"],
      groupMembers,
    });
    expect([...scope].sort()).toEqual(["s1", "s3"]);
  });

  it("reflects CURRENT group membership (later-added members included)", () => {
    // A member added to the group after configuration is included because the
    // membership map is resolved at read time.
    const withNewMember = new Map(groupMembers);
    withNewMember.set("g1", ["s1", "s2", "s3", "s99"]);
    const scope = resolveEventFeedScope({
      systemIds: [],
      groupIds: ["g1"],
      excludedSystemIds: [],
      groupMembers: withNewMember,
    });
    expect(scope.has("s99")).toBe(true);
  });

  it("returns empty when nothing is bound", () => {
    const scope = resolveEventFeedScope({
      systemIds: [],
      groupIds: [],
      excludedSystemIds: [],
      groupMembers,
    });
    expect(scope.size).toBe(0);
  });

  it("ignores unknown group ids", () => {
    const scope = resolveEventFeedScope({
      systemIds: ["s1"],
      groupIds: ["nope"],
      excludedSystemIds: [],
      groupMembers,
    });
    expect([...scope]).toEqual(["s1"]);
  });

  it("honors exclusions of a group member (send-time privacy boundary)", () => {
    // The fan-out uses this SAME expansion, so an excluded group member is
    // neither shown by the widget nor emailed about - single source, no drift.
    const scope = resolveEventFeedScope({
      systemIds: [],
      groupIds: ["g1"],
      excludedSystemIds: ["s2"],
      groupMembers,
    });
    expect(scope.has("s2")).toBe(false);
    expect(scope.has("s1")).toBe(true);
  });
});
