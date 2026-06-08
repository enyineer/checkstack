import { describe, expect, it } from "bun:test";
import type { JiraField } from "@checkstack/integration-jira-common";
import { coerceFieldValue, buildAdditionalFields } from "./additional-fields";

function field(over: Partial<JiraField>): JiraField {
  return { key: "f", name: "Field", required: false, ...over };
}

describe("coerceFieldValue", () => {
  it("wraps a bare string into an array for an array-of-string field (labels)", () => {
    const r = coerceFieldValue("payments-db", field({ key: "labels", name: "Labels", schema: { type: "array", items: "string" } }));
    expect(r).toEqual({ ok: true, value: ["payments-db"] });
  });

  it("accepts a JSON array literal for an array field", () => {
    const r = coerceFieldValue('["a","b"]', field({ schema: { type: "array", items: "string" } }));
    expect(r).toEqual({ ok: true, value: ["a", "b"] });
  });

  it("coerces a number field", () => {
    expect(coerceFieldValue("5", field({ schema: { type: "number" } }))).toEqual({ ok: true, value: 5 });
    const bad = coerceFieldValue("five", field({ name: "Story points", schema: { type: "number" } }));
    expect(bad.ok).toBe(false);
  });

  it("maps an option value to { id } via allowedValues", () => {
    const f = field({
      name: "Severity",
      schema: { type: "option" },
      allowedValues: [{ id: "1", name: "High" }, { id: "2", name: "Low" }],
    });
    expect(coerceFieldValue("High", f)).toEqual({ ok: true, value: { id: "1" } });
  });

  it("rejects an option value outside the allowed set", () => {
    const f = field({
      name: "Severity",
      schema: { type: "option" },
      allowedValues: [{ id: "1", name: "High" }],
    });
    const r = coerceFieldValue("Nope", f);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Allowed: High");
  });

  it("maps array-of-option elements to { id } via allowedValues", () => {
    const f = field({
      name: "Flagged",
      schema: { type: "array", items: "option" },
      allowedValues: [{ id: "10", value: "Impediment" }],
    });
    expect(coerceFieldValue("Impediment", f)).toEqual({ ok: true, value: [{ id: "10" }] });
  });

  it("passes string/date types through unchanged", () => {
    expect(coerceFieldValue("2026-06-15", field({ schema: { type: "date" } }))).toEqual({ ok: true, value: "2026-06-15" });
    expect(coerceFieldValue("hello", field({ schema: { type: "string" } }))).toEqual({ ok: true, value: "hello" });
  });
});

describe("buildAdditionalFields", () => {
  const fields: JiraField[] = [
    field({ key: "labels", name: "Labels", schema: { type: "array", items: "string" } }),
    field({ key: "customfield_10016", name: "Story points", schema: { type: "number" } }),
  ];

  it("coerces every known mapping into Jira-shaped values", () => {
    const { additionalFields, errors } = buildAdditionalFields({
      mappings: [
        { fieldKey: "labels", value: "payments-db" },
        { fieldKey: "customfield_10016", value: "8" },
      ],
      fields,
    });
    expect(errors).toEqual([]);
    expect(additionalFields).toEqual({ labels: ["payments-db"], customfield_10016: 8 });
  });

  it("reports an unknown field key as a validation error", () => {
    const { additionalFields, errors } = buildAdditionalFields({
      mappings: [{ fieldKey: "made_up", value: "x" }],
      fields,
    });
    expect(additionalFields).toEqual({});
    expect(errors[0]).toContain('Unknown Jira field "made_up"');
  });
});
