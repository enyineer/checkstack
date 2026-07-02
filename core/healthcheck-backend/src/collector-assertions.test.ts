import { describe, expect, it } from "bun:test";
import type { CollectorAssertion } from "@checkstack/healthcheck-common";
import { evaluateCollectorAssertions } from "./collector-assertions";

/** The HTTP Request collector's result shape, as the executor sees it. */
const httpResult = (body: string): Record<string, unknown> => ({
  statusCode: 200,
  statusText: "OK",
  responseTimeMs: 12,
  body,
  bodyLength: body.length,
  success: true,
});

const jsonPathAssertion = (
  jsonPath: string,
  operator: string,
  value?: unknown,
): CollectorAssertion => ({
  field: "body.$",
  jsonPath,
  operator,
  ...(value === undefined ? {} : { value }),
});

describe("evaluateCollectorAssertions", () => {
  describe("plain field assertions (regression)", () => {
    it("passes and fails on a direct result field", () => {
      const result = httpResult("{}");

      expect(
        evaluateCollectorAssertions({
          assertions: [{ field: "statusCode", operator: "equals", value: 200 }],
          result,
        }),
      ).toBeUndefined();

      expect(
        evaluateCollectorAssertions({
          assertions: [{ field: "statusCode", operator: "equals", value: 404 }],
          result,
        }),
      ).toBe("statusCode equals 404");
    });

    it("returns undefined for no assertions", () => {
      expect(
        evaluateCollectorAssertions({
          assertions: undefined,
          result: httpResult(""),
        }),
      ).toBeUndefined();
      expect(
        evaluateCollectorAssertions({ assertions: [], result: httpResult("") }),
      ).toBeUndefined();
    });

    it("returns the FIRST failing assertion in configured order", () => {
      const failure = evaluateCollectorAssertions({
        assertions: [
          { field: "success", operator: "isFalse" },
          { field: "statusCode", operator: "equals", value: 404 },
        ],
        result: httpResult("{}"),
      });
      expect(failure).toBe("success isFalse");
    });
  });

  describe("JSONPath assertions: extraction actually happens", () => {
    it("exists fails when the key is missing and passes when present", () => {
      expect(
        evaluateCollectorAssertions({
          assertions: [jsonPathAssertion("$.error", "exists")],
          result: httpResult(`{"status":"ok"}`),
        }),
      ).toBe("body.$ $.error exists");

      expect(
        evaluateCollectorAssertions({
          assertions: [jsonPathAssertion("$.error", "exists")],
          result: httpResult(`{"error":""}`),
        }),
      ).toBeUndefined();
    });

    it("notExists passes for a missing key and fails for a present one", () => {
      expect(
        evaluateCollectorAssertions({
          assertions: [jsonPathAssertion("$.error", "notExists")],
          result: httpResult(`{"status":"ok"}`),
        }),
      ).toBeUndefined();

      expect(
        evaluateCollectorAssertions({
          assertions: [jsonPathAssertion("$.error", "notExists")],
          result: httpResult(`{"error":"boom"}`),
        }),
      ).toBe("body.$ $.error notExists");
    });

    it("equals compares the EXTRACTED value, not the whole body", () => {
      expect(
        evaluateCollectorAssertions({
          assertions: [jsonPathAssertion("$.data.id", "equals", "42")],
          result: httpResult(`{"data":{"id":42},"noise":"x"}`),
        }),
      ).toBeUndefined();

      expect(
        evaluateCollectorAssertions({
          assertions: [jsonPathAssertion("$.data.id", "equals", "43")],
          result: httpResult(`{"data":{"id":42}}`),
        }),
      ).toBe("body.$ $.data.id equals 43");
    });

    it('asserts "error exists but is empty" via exists + isEmpty', () => {
      const assertions = [
        jsonPathAssertion("$.error", "exists"),
        jsonPathAssertion("$.error", "isEmpty"),
      ];

      // Present and empty string: both pass.
      expect(
        evaluateCollectorAssertions({
          assertions,
          result: httpResult(`{"error":""}`),
        }),
      ).toBeUndefined();

      // Missing entirely: exists fails (isEmpty alone would have passed).
      expect(
        evaluateCollectorAssertions({
          assertions,
          result: httpResult(`{"status":"ok"}`),
        }),
      ).toBe("body.$ $.error exists");

      // Present and non-empty: isEmpty fails.
      expect(
        evaluateCollectorAssertions({
          assertions,
          result: httpResult(`{"error":"boom"}`),
        }),
      ).toBe("body.$ $.error isEmpty");
    });
  });

  describe("empty arrays in JSON responses", () => {
    it("isEmpty passes for [] and fails for a populated array", () => {
      expect(
        evaluateCollectorAssertions({
          assertions: [jsonPathAssertion("$.errors", "isEmpty")],
          result: httpResult(`{"errors":[]}`),
        }),
      ).toBeUndefined();

      expect(
        evaluateCollectorAssertions({
          assertions: [jsonPathAssertion("$.errors", "isEmpty")],
          result: httpResult(`{"errors":["boom"]}`),
        }),
      ).toBe("body.$ $.errors isEmpty");
    });

    it("isNotEmpty passes for a populated array and fails for []", () => {
      expect(
        evaluateCollectorAssertions({
          assertions: [jsonPathAssertion("$.items", "isNotEmpty")],
          result: httpResult(`{"items":[1]}`),
        }),
      ).toBeUndefined();

      expect(
        evaluateCollectorAssertions({
          assertions: [jsonPathAssertion("$.items", "isNotEmpty")],
          result: httpResult(`{"items":[]}`),
        }),
      ).toBe("body.$ $.items isNotEmpty");
    });

    it("isEmpty handles empty objects and nested paths", () => {
      expect(
        evaluateCollectorAssertions({
          assertions: [jsonPathAssertion("$.meta.warnings", "isEmpty")],
          result: httpResult(`{"meta":{"warnings":{}}}`),
        }),
      ).toBeUndefined();

      expect(
        evaluateCollectorAssertions({
          assertions: [jsonPathAssertion("$.meta.warnings", "isEmpty")],
          result: httpResult(`{"meta":{"warnings":{"w1":"x"}}}`),
        }),
      ).toBe("body.$ $.meta.warnings isEmpty");
    });

    it("array length is assertable via the .length property", () => {
      expect(
        evaluateCollectorAssertions({
          assertions: [
            jsonPathAssertion("$.items.length", "greaterThan", "2"),
          ],
          result: httpResult(`{"items":[1,2,3]}`),
        }),
      ).toBeUndefined();

      expect(
        evaluateCollectorAssertions({
          assertions: [
            jsonPathAssertion("$.items.length", "greaterThan", "5"),
          ],
          result: httpResult(`{"items":[1,2,3]}`),
        }),
      ).toBe("body.$ $.items.length greaterThan 5");
    });
  });

  describe("fail-closed diagnostics", () => {
    it("fails with a diagnostic when the body is not valid JSON", () => {
      expect(
        evaluateCollectorAssertions({
          assertions: [jsonPathAssertion("$.error", "notExists")],
          result: httpResult("<html>not json</html>"),
        }),
      ).toBe('body.$ $.error notExists (field "body" is not valid JSON)');
    });

    it("fails with a diagnostic when the source field is absent", () => {
      expect(
        evaluateCollectorAssertions({
          assertions: [jsonPathAssertion("$.error", "exists")],
          result: { statusCode: 200 },
        }),
      ).toBe('body.$ $.error exists (field "body" has no value)');
    });

    it("fails with a diagnostic when the JSONPath expression is missing", () => {
      expect(
        evaluateCollectorAssertions({
          assertions: [{ field: "body.$", jsonPath: "  ", operator: "exists" }],
          result: httpResult("{}"),
        }),
      ).toBe("body.$ exists (missing JSONPath expression)");
    });

    it("rejects filter/script expressions instead of evaluating them", () => {
      const failure = evaluateCollectorAssertions({
        assertions: [
          jsonPathAssertion(`$.items[?(@.x==1)]`, "exists"),
        ],
        result: httpResult(`{"items":[{"x":1}]}`),
      });
      expect(failure).toContain("invalid JSONPath");
    });
  });

  describe("structured (non-string) source fields", () => {
    it("evaluates JSONPath against an already-parsed object field", () => {
      expect(
        evaluateCollectorAssertions({
          assertions: [
            {
              field: "details.$",
              jsonPath: "$.nodes",
              operator: "isEmpty",
            },
          ],
          result: { details: { nodes: [] } },
        }),
      ).toBeUndefined();
    });
  });
});
