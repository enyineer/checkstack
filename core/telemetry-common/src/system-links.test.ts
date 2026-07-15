import { describe, it, expect } from "bun:test";
import {
  MAX_SYSTEMS_PER_STATUS_LOOKUP,
  chunkSystemIdsForStatusLookup,
  mergeLinkedStreamStatuses,
} from "./system-links";

describe("chunkSystemIdsForStatusLookup", () => {
  it("returns one chunk at or below the cap and splits above it", () => {
    expect(chunkSystemIdsForStatusLookup([])).toEqual([]);
    const atCap = Array.from(
      { length: MAX_SYSTEMS_PER_STATUS_LOOKUP },
      (_, i) => `s${i}`,
    );
    expect(chunkSystemIdsForStatusLookup(atCap)).toEqual([atCap]);
    const overCap = [...atCap, "extra"];
    const chunks = chunkSystemIdsForStatusLookup(overCap);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(MAX_SYSTEMS_PER_STATUS_LOOKUP);
    expect(chunks[1]).toEqual(["extra"]);
  });
});

describe("mergeLinkedStreamStatuses", () => {
  const event = (ts: string) => ({ type: "spike", ts: new Date(ts) });

  it("unions systemIds for a stream appearing in multiple chunks", () => {
    const merged = mergeLinkedStreamStatuses([
      {
        matches: [
          { id: "st1", name: "A", systemIds: ["s1"], lastImportantEvent: null },
        ],
      },
      {
        matches: [
          {
            id: "st1",
            name: "A",
            systemIds: ["s2", "s1"],
            lastImportantEvent: null,
          },
          { id: "st2", name: "B", systemIds: ["s3"], lastImportantEvent: null },
        ],
      },
    ]);
    expect(merged).toHaveLength(2);
    const st1 = merged.find((m) => m.id === "st1");
    expect(st1?.systemIds.sort()).toEqual(["s1", "s2"]);
  });

  it("keeps the newest lastImportantEvent across chunks", () => {
    const merged = mergeLinkedStreamStatuses([
      {
        matches: [
          {
            id: "st1",
            name: "A",
            systemIds: ["s1"],
            lastImportantEvent: event("2026-07-15T00:00:00Z"),
          },
        ],
      },
      {
        matches: [
          {
            id: "st1",
            name: "A",
            systemIds: ["s2"],
            lastImportantEvent: event("2026-07-15T01:00:00Z"),
          },
        ],
      },
    ]);
    expect(merged[0]?.lastImportantEvent?.ts.toISOString()).toBe(
      "2026-07-15T01:00:00.000Z",
    );
    // Order-independent: newest survives even when it arrives first.
    const reversed = mergeLinkedStreamStatuses([
      {
        matches: [
          {
            id: "st1",
            name: "A",
            systemIds: ["s1"],
            lastImportantEvent: event("2026-07-15T01:00:00Z"),
          },
        ],
      },
      {
        matches: [
          {
            id: "st1",
            name: "A",
            systemIds: ["s2"],
            lastImportantEvent: null,
          },
        ],
      },
    ]);
    expect(reversed[0]?.lastImportantEvent?.ts.toISOString()).toBe(
      "2026-07-15T01:00:00.000Z",
    );
  });

  it("does not mutate the input results", () => {
    const input = {
      matches: [
        { id: "st1", name: "A", systemIds: ["s1"], lastImportantEvent: null },
      ],
    };
    const merged = mergeLinkedStreamStatuses([
      input,
      {
        matches: [
          { id: "st1", name: "A", systemIds: ["s2"], lastImportantEvent: null },
        ],
      },
    ]);
    expect(merged[0]?.systemIds).toEqual(["s1", "s2"]);
    expect(input.matches[0]?.systemIds).toEqual(["s1"]);
  });
});
