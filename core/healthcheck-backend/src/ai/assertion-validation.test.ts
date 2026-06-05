import { describe, expect, test } from "bun:test";
import { validateCollectorAssertions } from "./assertion-validation";
import type { CollectorConfigEntry } from "@checkstack/healthcheck-common";

const httpResultSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    statusCode: { type: "number" },
    body: { type: "string" },
    ok: { type: "boolean" },
  },
};

const schemas = new Map([["healthcheck-http.request", httpResultSchema]]);

function collector(
  assertions: CollectorConfigEntry["assertions"],
): CollectorConfigEntry[] {
  return [
    {
      id: "c1",
      collectorId: "healthcheck-http.request",
      config: {},
      assertions,
    },
  ];
}

describe("validateCollectorAssertions", () => {
  test("accepts a valid field + operator", () => {
    const issues = validateCollectorAssertions({
      collectors: collector([
        { field: "statusCode", operator: "equals", value: 200 },
      ]),
      resultSchemasById: schemas,
    });
    expect(issues).toEqual([]);
  });

  test("rejects an unknown operator (the reported 'eq' bug)", () => {
    const issues = validateCollectorAssertions({
      collectors: collector([
        { field: "statusCode", operator: "eq", value: 200 },
      ]),
      resultSchemasById: schemas,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual(["collectors", 0, "assertions", 0, "operator"]);
    expect(issues[0].message).toContain("Unknown operator");
    expect(issues[0].message).toContain("equals");
  });

  test("rejects an unknown field (the reported 'status' bug)", () => {
    const issues = validateCollectorAssertions({
      collectors: collector([
        { field: "status", operator: "equals", value: 200 },
      ]),
      resultSchemasById: schemas,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual(["collectors", 0, "assertions", 0, "field"]);
    expect(issues[0].message).toContain("statusCode");
  });

  test("rejects an operator not valid for the field's type", () => {
    const issues = validateCollectorAssertions({
      // contains is a string operator; statusCode is a number field.
      collectors: collector([
        { field: "statusCode", operator: "contains", value: "2" },
      ]),
      resultSchemasById: schemas,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("not valid for number field");
  });

  test("validates a JSONPath assertion against the dynamic operator set only", () => {
    const ok = validateCollectorAssertions({
      collectors: collector([
        { field: "body", jsonPath: "$.data.id", operator: "exists" },
      ]),
      resultSchemasById: schemas,
    });
    expect(ok).toEqual([]);

    const bad = validateCollectorAssertions({
      collectors: collector([
        { field: "body", jsonPath: "$.items", operator: "lengthEquals", value: 3 },
      ]),
      resultSchemasById: schemas,
    });
    expect(bad).toHaveLength(1);
    expect(bad[0].message).toContain("JSONPath");
  });

  test("skips validation when the collector's result schema is unknown", () => {
    const issues = validateCollectorAssertions({
      collectors: collector([
        { field: "anything", operator: "equals", value: 1 },
      ]),
      resultSchemasById: new Map(),
    });
    expect(issues).toEqual([]);
  });

  test("no collectors or no assertions yields no issues", () => {
    expect(
      validateCollectorAssertions({ collectors: undefined, resultSchemasById: schemas }),
    ).toEqual([]);
    expect(
      validateCollectorAssertions({
        collectors: collector(undefined),
        resultSchemasById: schemas,
      }),
    ).toEqual([]);
  });
});
