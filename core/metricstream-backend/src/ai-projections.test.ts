import { describe, it, expect } from "bun:test";
import { projectStreamListForModel } from "./ai-projections";

describe("projectStreamListForModel", () => {
  it("slims each stream to id/name/description and adds `returned`", () => {
    const output = {
      streams: [
        {
          id: "s1",
          name: "Payments",
          description: "payment metrics",
          // Fields the model does not need - must be dropped.
          config: { seriesCap: 5000, minuteRetentionHours: 24 },
          createdAt: new Date("2026-01-01T00:00:00Z"),
          updatedAt: new Date("2026-02-01T00:00:00Z"),
        },
        { id: "s2", name: "Checkout", description: null, config: {} },
      ],
    };
    expect(projectStreamListForModel(output)).toEqual({
      streams: [
        { id: "s1", name: "Payments", description: "payment metrics" },
        { id: "s2", name: "Checkout", description: null },
      ],
      returned: 2,
    });
  });

  it("returns an empty projection for an empty stream list", () => {
    expect(projectStreamListForModel({ streams: [] })).toEqual({
      streams: [],
      returned: 0,
    });
  });

  it("falls through unchanged when the shape does not match (defensive)", () => {
    const notAListStreams = { foo: "bar" };
    expect(projectStreamListForModel(notAListStreams)).toBe(notAListStreams);
    expect(projectStreamListForModel(null)).toBeNull();
    // A stream missing `id` fails the schema -> full output returned unchanged.
    const missingId = { streams: [{ name: "no id" }] };
    expect(projectStreamListForModel(missingId)).toBe(missingId);
  });
});
