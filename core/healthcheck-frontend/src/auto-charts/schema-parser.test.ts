import { describe, expect, test } from "bun:test";
import {
  DEFAULT_CHART_PRIORITY,
  extractChartFields,
  getFieldValue,
} from "./schema-parser";

/** An http-shaped result schema: strategy fields + a nested collector. */
const httpLikeSchema = {
  type: "object",
  properties: {
    responseTime: {
      type: "number",
      "x-chart-type": "line",
      "x-chart-label": "Response Time",
      "x-chart-unit": "ms",
      "x-chart-priority": 10,
      "x-anomaly-direction": "lower-is-better",
    },
    successRate: {
      type: "number",
      "x-chart-type": "gauge",
      "x-chart-unit": "%",
      "x-chart-good-direction": "up",
    },
    notCharted: { type: "string" },
    collectors: {
      type: "object",
      properties: {
        "abc-123": {
          type: "object",
          properties: {
            statusCode: {
              type: "number",
              "x-chart-type": "counter",
              "x-chart-label": "Status Code",
            },
            role: {
              type: "string",
              "x-chart-type": "text",
            },
          },
        },
      },
    },
  },
};

describe("extractChartFields", () => {
  test("extracts strategy-level and nested collector fields", () => {
    const fields = extractChartFields(httpLikeSchema);
    expect(fields.map((f) => f.name).toSorted()).toEqual([
      "responseTime",
      "role",
      "statusCode",
      "successRate",
    ]);
    const statusCode = fields.find((f) => f.name === "statusCode");
    expect(statusCode?.collectorId).toBe("abc-123");
    expect(statusCode?.chartType).toBe("counter");
  });

  test("skips fields without x-chart-type", () => {
    const fields = extractChartFields(httpLikeSchema);
    expect(fields.some((f) => f.name === "notCharted")).toBe(false);
  });

  test("labels fall back to a humanized field name", () => {
    const fields = extractChartFields(httpLikeSchema);
    expect(fields.find((f) => f.name === "successRate")?.label).toBe(
      "Success Rate",
    );
    expect(fields.find((f) => f.name === "responseTime")?.label).toBe(
      "Response Time",
    );
  });

  test("explicit x-chart-priority wins; others default", () => {
    const fields = extractChartFields(httpLikeSchema);
    expect(fields.find((f) => f.name === "responseTime")?.priority).toBe(10);
    expect(fields.find((f) => f.name === "statusCode")?.priority).toBe(
      DEFAULT_CHART_PRIORITY,
    );
  });

  test("goodDirection: explicit wins, else derived from x-anomaly-direction", () => {
    const fields = extractChartFields(httpLikeSchema);
    expect(fields.find((f) => f.name === "successRate")?.goodDirection).toBe(
      "up",
    );
    // responseTime has no explicit good-direction; lower-is-better => down.
    expect(fields.find((f) => f.name === "responseTime")?.goodDirection).toBe(
      "down",
    );
    expect(
      fields.find((f) => f.name === "statusCode")?.goodDirection,
    ).toBeUndefined();
  });

  test("explicit x-chart-good-direction overrides the anomaly fallback", () => {
    const fields = extractChartFields({
      type: "object",
      properties: {
        weird: {
          type: "number",
          "x-chart-type": "line",
          "x-chart-good-direction": "up",
          "x-anomaly-direction": "lower-is-better",
        },
      },
    });
    expect(fields[0]?.goodDirection).toBe("up");
  });

  test("invalid annotation values are rejected, not trusted", () => {
    const fields = extractChartFields({
      type: "object",
      properties: {
        sketchy: {
          type: "number",
          "x-chart-type": "line",
          "x-chart-priority": Number.POSITIVE_INFINITY,
          "x-chart-good-direction": "sideways",
        },
      },
    });
    expect(fields[0]?.priority).toBe(DEFAULT_CHART_PRIORITY);
    expect(fields[0]?.goodDirection).toBeUndefined();
  });

  test("record and array schema types are annotated", () => {
    const fields = extractChartFields({
      type: "object",
      properties: {
        codes: {
          type: "object",
          additionalProperties: { type: "number" },
          "x-chart-type": "pie",
        },
        values: {
          type: "array",
          items: { type: "string" },
          "x-chart-type": "text",
        },
      },
    });
    expect(fields.find((f) => f.name === "codes")?.schemaType).toBe(
      "record<number>",
    );
    expect(fields.find((f) => f.name === "values")?.schemaType).toBe(
      "array<string>",
    );
  });

  test("null/undefined/non-object schemas yield no fields", () => {
    expect(extractChartFields(null)).toEqual([]);
    expect(extractChartFields(undefined)).toEqual([]);
    expect(extractChartFields({ type: "string" })).toEqual([]);
  });
});

describe("getFieldValue", () => {
  const data = {
    responseTime: 120,
    aggregated: { _type: "average", avg: 98, sum: 980, count: 10 },
    collectors: {
      "abc-123": {
        statusCode: 200,
        rate: { _type: "rate", rate: 0.97, trueCount: 97, totalCount: 100 },
        hits: { _type: "counter", count: 42 },
        span: { _type: "minmax", min: 3, max: 91 },
      },
    },
  };

  test("direct field lookup", () => {
    expect(getFieldValue(data, "responseTime")).toBe(120);
  });

  test("collector-scoped lookup", () => {
    expect(getFieldValue(data, "statusCode", "abc-123")).toBe(200);
    expect(getFieldValue(data, "statusCode", "missing")).toBeUndefined();
  });

  test("unwraps every aggregated _type reduction", () => {
    expect(getFieldValue(data, "aggregated")).toBe(98);
    expect(getFieldValue(data, "rate", "abc-123")).toBe(0.97);
    expect(getFieldValue(data, "hits", "abc-123")).toBe(42);
    // minmax defaults to max.
    expect(getFieldValue(data, "span", "abc-123")).toBe(91);
  });

  test("falls back to searching collectors for strategy-level names", () => {
    expect(getFieldValue(data, "statusCode")).toBe(200);
  });

  test("missing data yields undefined", () => {
    expect(getFieldValue(undefined, "x")).toBeUndefined();
    expect(getFieldValue(data, "nope")).toBeUndefined();
  });
});

describe("boolean prose labels", () => {
  test("valid x-chart-true/false-label annotations are extracted", () => {
    const fields = extractChartFields({
      type: "object",
      properties: {
        success: {
          type: "boolean",
          "x-chart-type": "boolean",
          "x-chart-true-label": "successful",
          "x-chart-false-label": "failing",
        },
      },
    });
    expect(fields[0]?.trueLabel).toBe("successful");
    expect(fields[0]?.falseLabel).toBe("failing");
  });

  test("invalid or missing labels read as undefined", () => {
    const fields = extractChartFields({
      type: "object",
      properties: {
        success: {
          type: "boolean",
          "x-chart-type": "boolean",
          "x-chart-true-label": "",
          "x-chart-false-label": 42,
        },
      },
    });
    expect(fields[0]?.trueLabel).toBeUndefined();
    expect(fields[0]?.falseLabel).toBeUndefined();
  });
});
