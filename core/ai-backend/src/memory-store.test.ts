import { describe, expect, test } from "bun:test";
import {
  recallHintSimilarity,
  scoreMemory,
  isMemoryVisibleTo,
  DEDUP_THRESHOLD,
} from "./memory-store";

describe("isMemoryVisibleTo (the authoritative visibility rule)", () => {
  const viewer = { ownerId: "me", readableSystemIds: ["sysA", "sysB"] };

  test("a user can see THEIR OWN user-scoped memory", () => {
    expect(
      isMemoryVisibleTo(
        { scope: "user", ownerId: "me", systemId: null },
        viewer,
      ),
    ).toBe(true);
  });

  test("a user can NEVER see another principal's user-scoped memory", () => {
    expect(
      isMemoryVisibleTo(
        { scope: "user", ownerId: "someone-else", systemId: null },
        viewer,
      ),
    ).toBe(false);
  });

  test("a user can see a system memory for a system they can access", () => {
    expect(
      isMemoryVisibleTo(
        { scope: "system", ownerId: "anyone", systemId: "sysA" },
        viewer,
      ),
    ).toBe(true);
  });

  test("a user can NOT see a system memory for a system they cannot access", () => {
    expect(
      isMemoryVisibleTo(
        { scope: "system", ownerId: "anyone", systemId: "sysZ" },
        viewer,
      ),
    ).toBe(false);
  });

  test("a system memory with no readable systems is never visible", () => {
    expect(
      isMemoryVisibleTo(
        { scope: "system", ownerId: "me", systemId: "sysA" },
        { ownerId: "me", readableSystemIds: [] },
      ),
    ).toBe(false);
  });

  test("ownership does NOT grant visibility to a system memory without system access", () => {
    // Even the author of a system memory cannot see it if they lost access to
    // the system - system-scope visibility is access-driven, not owner-driven.
    expect(
      isMemoryVisibleTo(
        { scope: "system", ownerId: "me", systemId: "sysZ" },
        viewer,
      ),
    ).toBe(false);
  });
});

describe("recallHintSimilarity (dedup signal)", () => {
  test("identical hints are fully similar", () => {
    expect(recallHintSimilarity("file infra tickets in OPS", "file infra tickets in OPS")).toBe(1);
  });

  test("disjoint hints are not similar", () => {
    expect(recallHintSimilarity("jira project for infra", "preferred on-call rotation")).toBe(0);
  });

  test("a reworded version of the same fact clears the dedup threshold", () => {
    // Same core tokens, minor wording change -> should be treated as a duplicate.
    const sim = recallHintSimilarity(
      "recall when filing infra jira tickets",
      "recall when filing infra jira tickets for ops",
    );
    expect(sim).toBeGreaterThanOrEqual(DEDUP_THRESHOLD);
  });

  test("empty input is never similar", () => {
    expect(recallHintSimilarity("", "anything")).toBe(0);
  });
});

describe("scoreMemory (recall ranking)", () => {
  const memory = {
    recallHint: "recall when drafting infra jira tickets",
    content: "Use Jira project OPS for infrastructure work.",
    tags: ["jira", "infra"],
  };

  test("a query matching the recall hint scores above zero", () => {
    expect(scoreMemory("infra jira", memory)).toBeGreaterThan(0);
  });

  test("an unrelated query scores zero", () => {
    expect(scoreMemory("kubernetes helm chart", memory)).toBe(0);
  });

  test("a recall-hint hit outranks a content-only hit", () => {
    const hintHit = { recallHint: "deployment cadence", content: "x", tags: [] };
    const contentHit = { recallHint: "x", content: "deployment cadence notes", tags: [] };
    expect(scoreMemory("deployment cadence", hintHit)).toBeGreaterThan(
      scoreMemory("deployment cadence", contentHit),
    );
  });

  test("an empty query scores zero (no tokens)", () => {
    expect(scoreMemory("", memory)).toBe(0);
  });
});
