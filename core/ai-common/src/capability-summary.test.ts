import { describe, expect, test } from "bun:test";
import type { RawCapabilityEntry } from "./capability-summary";
import {
  applyCapabilitySizeGate,
  summarizeConfigSchema,
  summarizeFieldType,
  CAPABILITY_SUMMARY_ENTRY_CAP,
} from "./capability-summary";

describe("summarizeFieldType (pure)", () => {
  test("maps primitive JSON Schema types", () => {
    expect(summarizeFieldType({ property: { type: "string" } })).toBe("string");
    expect(summarizeFieldType({ property: { type: "boolean" } })).toBe(
      "boolean",
    );
    expect(summarizeFieldType({ property: { type: "number" } })).toBe("number");
    expect(summarizeFieldType({ property: { type: "integer" } })).toBe("number");
    expect(summarizeFieldType({ property: { type: "array" } })).toBe("array");
    expect(summarizeFieldType({ property: { type: "object" } })).toBe("object");
  });

  test("detects enum and union shapes ahead of the base type", () => {
    expect(
      summarizeFieldType({ property: { type: "string", enum: ["a", "b"] } }),
    ).toBe("enum");
    expect(
      summarizeFieldType({ property: { anyOf: [{ type: "string" }] } }),
    ).toBe("union");
    expect(
      summarizeFieldType({ property: { oneOf: [{ type: "number" }] } }),
    ).toBe("union");
  });

  test("handles array-typed `type` (nullable) and unknown nodes", () => {
    expect(summarizeFieldType({ property: { type: ["string", "null"] } })).toBe(
      "string|null",
    );
    expect(summarizeFieldType({ property: {} })).toBe("unknown");
    expect(summarizeFieldType({ property: 42 })).toBe("unknown");
    expect(summarizeFieldType({ property: null })).toBe("unknown");
  });
});

describe("summarizeConfigSchema (pure)", () => {
  test("derives name + type + required per property", () => {
    const summary = summarizeConfigSchema({
      configSchema: {
        type: "object",
        properties: {
          url: { type: "string" },
          method: { type: "string", enum: ["GET", "POST"] },
          retries: { type: "integer" },
          insecure: { type: "boolean" },
        },
        required: ["url", "method"],
      },
    });
    expect(summary).toEqual([
      { name: "url", type: "string", required: true },
      { name: "method", type: "enum", required: true },
      { name: "retries", type: "number", required: false },
      { name: "insecure", type: "boolean", required: false },
    ]);
  });

  test("returns undefined for a schema with no properties", () => {
    expect(
      summarizeConfigSchema({ configSchema: { type: "object" } }),
    ).toBeUndefined();
    expect(
      summarizeConfigSchema({ configSchema: {} }),
    ).toBeUndefined();
  });

  test("returns undefined for non-object / non-schema input", () => {
    expect(summarizeConfigSchema({ configSchema: null })).toBeUndefined();
    expect(summarizeConfigSchema({ configSchema: "nope" })).toBeUndefined();
    expect(summarizeConfigSchema({ configSchema: 7 })).toBeUndefined();
  });

  test("an empty properties object yields undefined, not []", () => {
    expect(
      summarizeConfigSchema({
        configSchema: { type: "object", properties: {} },
      }),
    ).toBeUndefined();
  });
});

function makeEntry(id: string): RawCapabilityEntry {
  return {
    id,
    displayName: id,
    role: "collector",
    configSummary: [{ name: "x", type: "string", required: true }],
  };
}

describe("applyCapabilitySizeGate (pure)", () => {
  test("keeps summaries and truncated=false at or below the cap", () => {
    const entries = Array.from({ length: CAPABILITY_SUMMARY_ENTRY_CAP }, (_, i) =>
      makeEntry(`c${i}`),
    );
    const gated = applyCapabilitySizeGate({ entries });
    expect(gated.truncated).toBe(false);
    expect(gated.entries).toHaveLength(CAPABILITY_SUMMARY_ENTRY_CAP);
    expect(gated.entries.every((e) => e.configSummary !== undefined)).toBe(true);
  });

  test("strips summaries and sets truncated=true above the cap", () => {
    const entries = Array.from(
      { length: CAPABILITY_SUMMARY_ENTRY_CAP + 1 },
      (_, i) => makeEntry(`c${i}`),
    );
    const gated = applyCapabilitySizeGate({ entries });
    expect(gated.truncated).toBe(true);
    // Identity + role survive; only the per-entry summary is dropped.
    expect(gated.entries).toHaveLength(CAPABILITY_SUMMARY_ENTRY_CAP + 1);
    expect(gated.entries.every((e) => e.configSummary === undefined)).toBe(true);
    expect(gated.entries[0].id).toBe("c0");
    expect(gated.entries[0].role).toBe("collector");
  });

  test("honors a custom entry cap", () => {
    const entries = [makeEntry("a"), makeEntry("b"), makeEntry("c")];
    const gated = applyCapabilitySizeGate({ entries, entryCap: 2 });
    expect(gated.truncated).toBe(true);
    expect(gated.entries.every((e) => e.configSummary === undefined)).toBe(true);
  });

  test("empty catalog is not truncated", () => {
    const gated = applyCapabilitySizeGate({ entries: [] });
    expect(gated.truncated).toBe(false);
    expect(gated.entries).toEqual([]);
  });
});
