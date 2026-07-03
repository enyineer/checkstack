import { describe, expect, test } from "bun:test";
import { computeAssertionKey } from "@checkstack/healthcheck-common";
import {
  OPERATOR_LABELS,
  buildAssertionGroups,
  buildAssertionRows,
  formatAssertionLabel,
  labelForAssertionKey,
  operatorSentence,
} from "./assertion-display.logic";

const KEY = computeAssertionKey({
  assertion: { field: "statusCode", operator: "equals", value: 200 },
});

function outcome(overrides: Record<string, unknown>) {
  return {
    key: KEY,
    field: "statusCode",
    operator: "equals",
    value: "200",
    passed: true,
    ...overrides,
  };
}

describe("operatorSentence / formatAssertionLabel", () => {
  test("labels known operators and passes unknown ones through", () => {
    expect(operatorSentence({ operator: "greaterThanOrEqual" })).toBe(
      "greater than or equal",
    );
    expect(operatorSentence({ operator: "matches" })).toBe("matches");
    expect(operatorSentence({ operator: "someFutureOp" })).toBe("someFutureOp");
  });

  test("formats plain, value-less, and JSONPath assertions", () => {
    expect(
      formatAssertionLabel({
        parts: { field: "statusCode", operator: "equals", value: "200" },
      }),
    ).toBe("statusCode equals 200");
    expect(
      formatAssertionLabel({ parts: { field: "valid", operator: "isTrue" } }),
    ).toBe("valid is true");
    expect(
      formatAssertionLabel({
        parts: {
          field: "body.$",
          jsonPath: "$.status",
          operator: "equals",
          value: "ok",
        },
      }),
    ).toBe("body.$ $.status equals ok");
  });

  test("labelForAssertionKey round-trips a canonical key", () => {
    expect(labelForAssertionKey({ key: KEY })).toBe("statusCode equals 200");
    // Malformed keys fall back to the raw key rather than crashing.
    expect(labelForAssertionKey({ key: "garbage" })).toBe("garbage");
  });
});

describe("buildAssertionRows", () => {
  test("builds one row per structured outcome, pass AND fail", () => {
    const rows = buildAssertionRows({
      collectorEntry: {
        _assertions: [
          outcome({ passed: true, actual: "200" }),
          outcome({
            passed: false,
            actual: "404",
            message: "statusCode: expected to equal 200, got 404",
          }),
        ],
      },
    });
    expect(rows.length).toBe(2);
    expect(rows[0]).toMatchObject({
      label: "statusCode equals 200",
      passed: true,
      actual: "200",
      legacy: false,
    });
    expect(rows[1]).toMatchObject({ passed: false, actual: "404" });
  });

  test("legacy runs fall back to a single failed row from _assertionFailed", () => {
    const rows = buildAssertionRows({
      collectorEntry: { _assertionFailed: "statusCode equals 200" },
    });
    expect(rows).toEqual([
      {
        id: "legacy-failure",
        label: "statusCode equals 200",
        passed: false,
        legacy: true,
      },
    ]);
  });

  test("no assertion info yields no rows; malformed outcomes are skipped", () => {
    expect(buildAssertionRows({ collectorEntry: {} })).toEqual([]);
    expect(
      buildAssertionRows({
        collectorEntry: { _assertions: ["garbage"] },
      }),
    ).toEqual([]);
  });
});

describe("buildAssertionGroups", () => {
  test("groups rows per collector entry with fail counts", () => {
    const groups = buildAssertionGroups({
      result: {
        metadata: {
          collectors: {
            "entry-1": {
              _collectorId: "healthcheck.http",
              _assertions: [outcome({ passed: false }), outcome({})],
            },
            "entry-2": { _collectorId: "healthcheck.tls" },
          },
        },
      },
    });
    expect(groups.length).toBe(1);
    expect(groups[0]).toMatchObject({
      collectorEntryId: "entry-1",
      collectorId: "healthcheck.http",
      failCount: 1,
    });
  });

  test("missing metadata yields no groups", () => {
    expect(buildAssertionGroups({ result: undefined })).toEqual([]);
    expect(buildAssertionGroups({ result: {} })).toEqual([]);
  });
});

describe("OPERATOR_LABELS", () => {
  test("covers every operator the builder offers", () => {
    for (const op of [
      "equals",
      "notEquals",
      "contains",
      "startsWith",
      "endsWith",
      "matches",
      "isEmpty",
      "isNotEmpty",
      "lessThan",
      "lessThanOrEqual",
      "greaterThan",
      "greaterThanOrEqual",
      "isTrue",
      "isFalse",
      "includes",
      "notIncludes",
      "lengthEquals",
      "lengthGreaterThan",
      "lengthLessThan",
      "exists",
      "notExists",
    ]) {
      expect(OPERATOR_LABELS[op]).toBeDefined();
    }
  });
});
