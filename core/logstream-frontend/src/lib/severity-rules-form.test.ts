import { describe, expect, it } from "bun:test";
import type { SeverityRules } from "@checkstack/logstream-common";
import {
  formToSeverityRules,
  severityRulesToForm,
} from "./severity-rules-form";

describe("severityRulesToForm", () => {
  it("returns empty rows for undefined rules", () => {
    expect(severityRulesToForm(undefined)).toEqual({
      valueMap: [],
      patternOverrides: [],
    });
  });

  it("maps a value map and pattern overrides to keyed rows", () => {
    const rules: SeverityRules = {
      valueMap: { INFO: "error", warn: "warn" },
      patternOverrides: [{ patternId: "p1", band: "fatal" }],
    };
    const form = severityRulesToForm(rules);
    expect(form.valueMap).toEqual([
      { id: "value-0", value: "INFO", band: "error" },
      { id: "value-1", value: "warn", band: "warn" },
    ]);
    expect(form.patternOverrides).toEqual([
      { id: "pattern-0", patternId: "p1", band: "fatal" },
    ]);
  });
});

describe("formToSeverityRules", () => {
  it("returns undefined when every row is blank", () => {
    expect(
      formToSeverityRules({
        valueMap: [{ id: "a", value: "  ", band: "error" }],
        patternOverrides: [{ id: "b", patternId: "", band: "warn" }],
      }),
    ).toBeUndefined();
  });

  it("omits the valueMap sub-key when it has no surviving rows", () => {
    const rules = formToSeverityRules({
      valueMap: [],
      patternOverrides: [{ id: "b", patternId: "p1", band: "warn" }],
    });
    expect(rules).toEqual({ patternOverrides: [{ patternId: "p1", band: "warn" }] });
    expect(rules && "valueMap" in rules).toBe(false);
  });

  it("omits the patternOverrides sub-key when it has no surviving rows", () => {
    const rules = formToSeverityRules({
      valueMap: [{ id: "a", value: "INFO", band: "error" }],
      patternOverrides: [],
    });
    expect(rules).toEqual({ valueMap: { INFO: "error" } });
    expect(rules && "patternOverrides" in rules).toBe(false);
  });

  it("trims values and drops blank rows", () => {
    const rules = formToSeverityRules({
      valueMap: [
        { id: "a", value: "  INFO  ", band: "error" },
        { id: "b", value: "   ", band: "warn" },
      ],
      patternOverrides: [{ id: "c", patternId: "  p1  ", band: "fatal" }],
    });
    expect(rules).toEqual({
      valueMap: { INFO: "error" },
      patternOverrides: [{ patternId: "p1", band: "fatal" }],
    });
  });

  it("resolves duplicate keys last-wins", () => {
    const rules = formToSeverityRules({
      valueMap: [
        { id: "a", value: "warn", band: "warn" },
        { id: "b", value: "warn", band: "error" },
      ],
      patternOverrides: [
        { id: "c", patternId: "p1", band: "warn" },
        { id: "d", patternId: "p1", band: "fatal" },
      ],
    });
    expect(rules).toEqual({
      valueMap: { warn: "error" },
      patternOverrides: [{ patternId: "p1", band: "fatal" }],
    });
  });

  it("round-trips config -> form -> config", () => {
    const rules: SeverityRules = {
      valueMap: { INFO: "error" },
      patternOverrides: [{ patternId: "p1", band: "fatal" }],
    };
    expect(formToSeverityRules(severityRulesToForm(rules))).toEqual(rules);
  });
});
