import { describe, it, expect } from "bun:test";
import {
  MAX_DERIVE_LABELS,
  parseLabelsInput,
  readFilterField,
  readLabelsInput,
  readMode,
  readString,
  setFilterField,
  setLabels,
  setMode,
  setStringField,
} from "./derive-config.logic";

describe("readers", () => {
  it("readString defaults to empty for missing/non-string", () => {
    expect(readString({ metricName: "m" }, "metricName")).toBe("m");
    expect(readString({}, "metricName")).toBe("");
    expect(readString({ metricName: 5 }, "metricName")).toBe("");
  });

  it("readMode defaults to count", () => {
    expect(readMode({})).toBe("count");
    expect(readMode({ mode: "extractNumber" })).toBe("extractNumber");
    expect(readMode({ mode: "bogus" })).toBe("count");
  });

  it("readFilterField reads numbers and strings from the nested filter", () => {
    expect(readFilterField({ filter: { minSeverityNumber: 17 } }, "minSeverityNumber")).toBe("17");
    expect(readFilterField({ filter: { bodyContains: "x" } }, "bodyContains")).toBe("x");
    expect(readFilterField({}, "bodyContains")).toBe("");
  });

  it("readLabelsInput joins a string array", () => {
    expect(readLabelsInput({ labelsFromAttributes: ["a", "b"] })).toBe("a, b");
    expect(readLabelsInput({})).toBe("");
  });
});

describe("parseLabelsInput", () => {
  it("splits, trims, de-dupes and caps", () => {
    expect(parseLabelsInput("a, b\nc, a")).toEqual(["a", "b", "c"]);
    expect(parseLabelsInput("")).toEqual([]);
    const many = Array.from({ length: MAX_DERIVE_LABELS + 3 }, (_, i) => `l${i}`).join(",");
    expect(parseLabelsInput(many)).toHaveLength(MAX_DERIVE_LABELS);
  });
});

describe("immutable setters", () => {
  it("setStringField sets and deletes on clear", () => {
    expect(setStringField({ config: {}, key: "metricName", value: "m" })).toEqual({ metricName: "m" });
    expect(setStringField({ config: { metricName: "m" }, key: "metricName", value: "" })).toEqual({});
  });

  it("setLabels stores the parsed array or removes it", () => {
    expect(setLabels({ config: {}, raw: "a, b" })).toEqual({ labelsFromAttributes: ["a", "b"] });
    expect(setLabels({ config: { labelsFromAttributes: ["a"] }, raw: "" })).toEqual({});
  });

  it("setFilterField coerces severity, keeps body, and prunes an empty filter", () => {
    expect(setFilterField({ config: {}, key: "minSeverityNumber", value: "17.9" })).toEqual({
      filter: { minSeverityNumber: 17 },
    });
    expect(
      setFilterField({ config: { filter: { minSeverityNumber: 17 } }, key: "bodyContains", value: "boom" }),
    ).toEqual({ filter: { minSeverityNumber: 17, bodyContains: "boom" } });
    // Clearing the only field removes the filter object entirely.
    expect(
      setFilterField({ config: { filter: { bodyContains: "boom" } }, key: "bodyContains", value: "" }),
    ).toEqual({});
  });

  it("setMode clears attributePath when leaving extractNumber", () => {
    expect(setMode({ config: { attributePath: "d" }, mode: "count" })).toEqual({ mode: "count" });
    expect(setMode({ config: {}, mode: "extractNumber" })).toEqual({ mode: "extractNumber" });
  });
});
