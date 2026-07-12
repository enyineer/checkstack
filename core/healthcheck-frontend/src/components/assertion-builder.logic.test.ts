import { describe, expect, test } from "bun:test";
import {
  assertionsAreValid,
  duplicateAssertionIndexes,
  extractAssertableFields,
  operatorOptionsForField,
  seedAssertion,
  validateAssertion,
  VALUE_LESS_OPERATORS,
  type AssertableField,
} from "./assertion-builder.logic";
import {
  OPERATOR_LABELS,
  OPERATOR_SENTENCE_LABELS,
} from "./assertion-display.logic";

/**
 * Result schema modeled on the HTTP request collector: annotated fields with
 * labels, units, boolean prose, priorities, and a JSONPath-enabled body.
 */
const HTTP_LIKE_SCHEMA = {
  type: "object",
  properties: {
    statusCode: {
      type: "number",
      "x-chart-label": "Status Code",
      "x-chart-priority": 20,
    },
    responseTimeMs: {
      type: "number",
      "x-chart-label": "Response Time",
      "x-chart-unit": "ms",
      "x-chart-priority": 10,
    },
    success: {
      type: "boolean",
      "x-chart-label": "HTTP Success",
      "x-chart-true-label": "successful",
      "x-chart-false-label": "failing",
    },
    body: {
      type: "string",
      "x-chart-label": "Response Body",
      "x-jsonpath": true,
    },
    unannotatedCount: { type: "integer" },
  },
} as const;

const fieldByPath = (fields: AssertableField[], path: string) => {
  const field = fields.find((f) => f.path === path);
  if (!field) throw new Error(`missing field ${path}`);
  return field;
};

describe("extractAssertableFields", () => {
  const fields = extractAssertableFields({ schema: HTTP_LIKE_SCHEMA });

  test("persisted paths are byte-for-byte the historic encoding", () => {
    expect(fields.map((f) => f.path).toSorted()).toEqual(
      [
        "statusCode",
        "responseTimeMs",
        "success",
        "body",
        "body.$",
        "unannotatedCount",
      ].toSorted(),
    );
  });

  test("labels come from x-chart-label with humanized fallback", () => {
    expect(fieldByPath(fields, "statusCode").label).toBe("Status Code");
    expect(fieldByPath(fields, "unannotatedCount").label).toBe(
      "Unannotated Count",
    );
  });

  test("units and boolean prose are carried through", () => {
    expect(fieldByPath(fields, "responseTimeMs").unit).toBe("ms");
    const success = fieldByPath(fields, "success");
    expect(success.trueLabel).toBe("successful");
    expect(success.falseLabel).toBe("failing");
  });

  test("jsonpath fields are advanced and sorted last; plain fields by priority", () => {
    const paths = fields.map((f) => f.path);
    // priority 10 (Response Time) before 20 (Status Code) before default-100.
    expect(paths.indexOf("responseTimeMs")).toBeLessThan(
      paths.indexOf("statusCode"),
    );
    expect(paths.indexOf("statusCode")).toBeLessThan(paths.indexOf("success"));
    // The advanced JSONPath row lists last.
    expect(paths.at(-1)).toBe("body.$");
    expect(fieldByPath(fields, "body.$").advanced).toBe(true);
    expect(fieldByPath(fields, "body.$").sourceField).toBe("body");
  });

  test("nested objects and array items compose readable labels and historic paths", () => {
    // A separate const (like HTTP_LIKE_SCHEMA): an inline literal would trip
    // TS's excess property check on the x-chart-* annotation keys.
    const NESTED_SCHEMA = {
      type: "object",
      properties: {
        tls: {
          type: "object",
          "x-chart-label": "TLS",
          properties: {
            daysRemaining: { type: "number", "x-chart-label": "Days Left" },
          },
        },
        records: {
          type: "array",
          "x-chart-label": "Records",
          items: {
            type: "object",
            properties: { name: { type: "string" } },
          },
        },
      },
    } as const;
    const nested = extractAssertableFields({ schema: NESTED_SCHEMA });
    expect(fieldByPath(nested, "tls.daysRemaining").label).toBe(
      "TLS › Days Left",
    );
    expect(fieldByPath(nested, "records[*].name").label).toBe(
      "Records item › Name",
    );
    // Array-level assertions still offered.
    expect(fieldByPath(nested, "records").type).toBe("array");
  });

  test("enums are extracted with their values", () => {
    const enumFields = extractAssertableFields({
      schema: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["SERVING", "NOT_SERVING"] },
        },
      },
    });
    expect(fieldByPath(enumFields, "status").type).toBe("enum");
    expect(fieldByPath(enumFields, "status").enumValues).toEqual([
      "SERVING",
      "NOT_SERVING",
    ]);
  });
});

describe("operator labels", () => {
  test("sentence labels cover exactly the operators the builder offers", () => {
    // Both maps must stay in lock-step so authoring and run-detail phrasing
    // agree; the sentence map additionally covers every offered operator.
    expect(Object.keys(OPERATOR_SENTENCE_LABELS).toSorted()).toEqual(
      Object.keys(OPERATOR_LABELS).toSorted(),
    );
  });

  test("boolean fields phrase isTrue/isFalse with the collector's prose", () => {
    const fields = extractAssertableFields({ schema: HTTP_LIKE_SCHEMA });
    const success = fieldByPath(fields, "success");
    expect(operatorOptionsForField({ field: success })).toEqual([
      { value: "isTrue", label: "be successful" },
      { value: "isFalse", label: "be failing" },
    ]);
  });

  test("a boolean without prose falls back to be true / be false", () => {
    const field: AssertableField = {
      path: "flag",
      label: "Flag",
      type: "boolean",
      priority: 100,
      advanced: false,
    };
    expect(operatorOptionsForField({ field }).map((o) => o.label)).toEqual([
      "be true",
      "be false",
    ]);
  });
});

describe("seedAssertion", () => {
  test("seeds from the highest-priority non-advanced field", () => {
    const fields = extractAssertableFields({ schema: HTTP_LIKE_SCHEMA });
    const seeded = seedAssertion({ fields });
    expect(seeded?.field).toBe("responseTimeMs");
    expect(seeded?.operator).toBe("equals");
  });

  test("returns undefined with no fields", () => {
    expect(seedAssertion({ fields: [] })).toBeUndefined();
  });
});

describe("validateAssertion", () => {
  const fields = extractAssertableFields({ schema: HTTP_LIKE_SCHEMA });

  test("a complete numeric assertion passes", () => {
    expect(
      validateAssertion({
        assertion: { field: "statusCode", operator: "equals", value: 200 },
        fields,
      }),
    ).toBeUndefined();
  });

  test("value-less operators need no value", () => {
    for (const operator of VALUE_LESS_OPERATORS) {
      // isTrue/isFalse only exist on booleans; use the matching field.
      const field = operator.startsWith("is") && operator !== "isEmpty" && operator !== "isNotEmpty" ? "success" : "body";
      const assertion = { field, operator, value: undefined };
      const message = validateAssertion({ assertion, fields });
      // Some operators aren't offered for that field type - only assert the
      // ones that are.
      if (message === "Pick a condition") continue;
      expect(message).toBeUndefined();
    }
  });

  test("missing value, unknown field, bad number, bad regex, bad jsonpath are flagged", () => {
    expect(
      validateAssertion({
        assertion: { field: "statusCode", operator: "equals", value: undefined },
        fields,
      }),
    ).toMatch(/value/i);
    expect(
      validateAssertion({
        assertion: { field: "removedField", operator: "equals", value: 1 },
        fields,
      }),
    ).toMatch(/field/i);
    expect(
      validateAssertion({
        assertion: { field: "statusCode", operator: "equals", value: "abc" },
        fields,
      }),
    ).toMatch(/number/i);
    expect(
      validateAssertion({
        assertion: { field: "body", operator: "matches", value: "([" },
        fields,
      }),
    ).toMatch(/regular expression/i);
    expect(
      validateAssertion({
        assertion: { field: "body.$", operator: "exists", jsonPath: "" },
        fields,
      }),
    ).toMatch(/JSONPath/i);
    expect(
      validateAssertion({
        assertion: { field: "body.$", operator: "exists", jsonPath: "status" },
        fields,
      }),
    ).toMatch(/\$/);
  });

  test("an operator that does not belong to the field type is flagged", () => {
    expect(
      validateAssertion({
        assertion: { field: "statusCode", operator: "contains", value: "2" },
        fields,
      }),
    ).toMatch(/condition/i);
  });
});

describe("duplicateAssertionIndexes / assertionsAreValid", () => {
  const fields = extractAssertableFields({ schema: HTTP_LIKE_SCHEMA });

  test("flags later duplicates only", () => {
    const a = { field: "statusCode", operator: "equals", value: 200 };
    const duplicates = duplicateAssertionIndexes({
      assertions: [
        a,
        { field: "responseTimeMs", operator: "lessThan", value: 500 },
        { ...a },
      ],
    });
    expect(duplicates).toEqual(new Set([2]));
  });

  test("assertionsAreValid: empty list is valid; one incomplete row invalidates", () => {
    expect(assertionsAreValid({ assertions: [], fields })).toBe(true);
    expect(
      assertionsAreValid({
        assertions: [
          { field: "statusCode", operator: "equals", value: 200 },
          { field: "statusCode", operator: "equals", value: undefined },
        ],
        fields,
      }),
    ).toBe(false);
  });
});
