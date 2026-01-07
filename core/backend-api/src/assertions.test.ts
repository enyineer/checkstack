import { describe, expect, it } from "bun:test";
import {
  evaluateAssertion,
  evaluateAssertions,
  evaluateJsonPathAssertions,
  numericField,
  timeThresholdField,
  stringField,
  booleanField,
  enumField,
  jsonPathField,
} from "./assertions";
import { z } from "zod";

describe("Assertion Schema Factories", () => {
  describe("numericField", () => {
    it("creates a schema with numeric operators", () => {
      const schema = numericField("packetLoss", { min: 0, max: 100 });

      const valid = schema.safeParse({
        field: "packetLoss",
        operator: "lessThan",
        value: 50,
      });
      expect(valid.success).toBe(true);

      const invalid = schema.safeParse({
        field: "packetLoss",
        operator: "lessThan",
        value: 150,
      });
      expect(invalid.success).toBe(false);
    });
  });

  describe("timeThresholdField", () => {
    it("only allows lessThan and lessThanOrEqual operators", () => {
      const schema = timeThresholdField("latency");

      const valid = schema.safeParse({
        field: "latency",
        operator: "lessThan",
        value: 100,
      });
      expect(valid.success).toBe(true);

      const invalid = schema.safeParse({
        field: "latency",
        operator: "greaterThan",
        value: 100,
      });
      expect(invalid.success).toBe(false);
    });
  });

  describe("stringField", () => {
    it("creates a schema with string operators", () => {
      const schema = stringField("banner");

      const valid = schema.safeParse({
        field: "banner",
        operator: "contains",
        value: "SSH",
      });
      expect(valid.success).toBe(true);
    });
  });

  describe("booleanField", () => {
    it("creates a schema with isTrue/isFalse operators", () => {
      const schema = booleanField("isExpired");

      const isTrue = schema.safeParse({
        field: "isExpired",
        operator: "isTrue",
      });
      expect(isTrue.success).toBe(true);

      const isFalse = schema.safeParse({
        field: "isExpired",
        operator: "isFalse",
      });
      expect(isFalse.success).toBe(true);
    });
  });

  describe("enumField", () => {
    it("creates a schema for enum values", () => {
      const schema = enumField("status", ["SERVING", "NOT_SERVING"] as const);

      const valid = schema.safeParse({
        field: "status",
        operator: "equals",
        value: "SERVING",
      });
      expect(valid.success).toBe(true);

      const invalid = schema.safeParse({
        field: "status",
        operator: "equals",
        value: "INVALID",
      });
      expect(invalid.success).toBe(false);
    });

    it("generates JSON Schema with enum values for select rendering", () => {
      const schema = enumField("status", [
        "SERVING",
        "NOT_SERVING",
        "UNKNOWN",
      ] as const);
      const jsonSchema = schema.toJSONSchema() as Record<string, unknown>;
      const properties = jsonSchema.properties as Record<
        string,
        Record<string, unknown>
      >;

      // Field should have const for discriminator
      expect(properties.field.const).toBe("status");

      // Operator should have const "equals"
      expect(properties.operator.const).toBe("equals");

      // Value should have enum array for select rendering
      expect(properties.value.enum).toEqual([
        "SERVING",
        "NOT_SERVING",
        "UNKNOWN",
      ]);
    });
  });

  describe("jsonPathField", () => {
    it("creates a schema with dynamic operators", () => {
      const schema = jsonPathField();

      const valid = schema.safeParse({
        path: "$.status",
        operator: "equals",
        value: "ok",
      });
      expect(valid.success).toBe(true);

      const exists = schema.safeParse({ path: "$.data", operator: "exists" });
      expect(exists.success).toBe(true);
    });
  });
});

describe("evaluateAssertion", () => {
  describe("numeric operators", () => {
    it("evaluates equals correctly", () => {
      const result = evaluateAssertion(
        { field: "count", operator: "equals", value: 5 },
        { count: 5 }
      );
      expect(result.passed).toBe(true);
    });

    it("evaluates lessThan correctly", () => {
      const result = evaluateAssertion(
        { field: "latency", operator: "lessThan", value: 100 },
        { latency: 50 }
      );
      expect(result.passed).toBe(true);

      const failed = evaluateAssertion(
        { field: "latency", operator: "lessThan", value: 100 },
        { latency: 150 }
      );
      expect(failed.passed).toBe(false);
      expect(failed.message).toContain("less than");
    });

    it("evaluates greaterThanOrEqual correctly", () => {
      const result = evaluateAssertion(
        { field: "uptime", operator: "greaterThanOrEqual", value: 99 },
        { uptime: 99 }
      );
      expect(result.passed).toBe(true);
    });
  });

  describe("string operators", () => {
    it("evaluates contains correctly", () => {
      const result = evaluateAssertion(
        { field: "stdout", operator: "contains", value: "OK" },
        { stdout: "Status: OK" }
      );
      expect(result.passed).toBe(true);
    });

    it("evaluates startsWith correctly", () => {
      const result = evaluateAssertion(
        { field: "banner", operator: "startsWith", value: "SSH-2.0" },
        { banner: "SSH-2.0-OpenSSH" }
      );
      expect(result.passed).toBe(true);
    });

    it("evaluates matches correctly", () => {
      const result = evaluateAssertion(
        { field: "version", operator: "matches", value: "v\\d+\\.\\d+" },
        { version: "v1.2.3" }
      );
      expect(result.passed).toBe(true);
    });

    it("evaluates isEmpty correctly", () => {
      const result = evaluateAssertion(
        { field: "stderr", operator: "isEmpty" },
        { stderr: "" }
      );
      expect(result.passed).toBe(true);
    });
  });

  describe("boolean operators", () => {
    it("evaluates isTrue correctly", () => {
      const result = evaluateAssertion(
        { field: "connected", operator: "isTrue" },
        { connected: true }
      );
      expect(result.passed).toBe(true);

      const failed = evaluateAssertion(
        { field: "connected", operator: "isTrue" },
        { connected: false }
      );
      expect(failed.passed).toBe(false);
    });

    it("evaluates isFalse correctly", () => {
      const result = evaluateAssertion(
        { field: "isExpired", operator: "isFalse" },
        { isExpired: false }
      );
      expect(result.passed).toBe(true);
    });
  });

  describe("existence operators", () => {
    it("evaluates exists correctly", () => {
      const result = evaluateAssertion(
        { field: "data", operator: "exists" },
        { data: { foo: "bar" } }
      );
      expect(result.passed).toBe(true);

      const notExists = evaluateAssertion(
        { field: "data", operator: "exists" },
        { data: null }
      );
      expect(notExists.passed).toBe(false);
    });

    it("evaluates notExists correctly", () => {
      const result = evaluateAssertion(
        { field: "error", operator: "notExists" },
        { error: undefined }
      );
      expect(result.passed).toBe(true);
    });
  });
});

describe("evaluateAssertions", () => {
  it("returns null when all assertions pass", () => {
    const assertions = [
      { field: "status", operator: "equals", value: 200 },
      { field: "latency", operator: "lessThan", value: 100 },
    ];
    const result = evaluateAssertions(assertions, { status: 200, latency: 50 });
    expect(result).toBe(null);
  });

  it("returns the first failed assertion", () => {
    const assertions = [
      { field: "status", operator: "equals", value: 200 },
      { field: "latency", operator: "lessThan", value: 100 },
    ];
    const result = evaluateAssertions(assertions, {
      status: 200,
      latency: 150,
    });
    expect(result).toEqual({
      field: "latency",
      operator: "lessThan",
      value: 100,
    });
  });

  it("returns null for empty or undefined assertions", () => {
    expect(evaluateAssertions([], {})).toBe(null);
    expect(evaluateAssertions(undefined, {})).toBe(null);
  });
});

describe("evaluateJsonPathAssertions", () => {
  const extractPath = (path: string, json: unknown) => {
    // Simple mock extractor for testing
    if (path === "$.status") return (json as Record<string, unknown>)?.status;
    if (path === "$.count") return (json as Record<string, unknown>)?.count;
    return undefined;
  };

  it("evaluates JSONPath assertions with string coercion", () => {
    const assertions = [{ path: "$.status", operator: "equals", value: "ok" }];
    const result = evaluateJsonPathAssertions(
      assertions,
      { status: "ok" },
      extractPath
    );
    expect(result).toBe(null);
  });

  it("evaluates JSONPath assertions with numeric coercion", () => {
    const assertions = [
      { path: "$.count", operator: "greaterThan", value: "5" },
    ];
    const result = evaluateJsonPathAssertions(
      assertions,
      { count: 10 },
      extractPath
    );
    expect(result).toBe(null);

    const failed = evaluateJsonPathAssertions(
      assertions,
      { count: 3 },
      extractPath
    );
    expect(failed).toEqual(assertions[0]);
  });

  it("evaluates existence checks", () => {
    const assertions = [{ path: "$.status", operator: "exists" }];
    const result = evaluateJsonPathAssertions(
      assertions,
      { status: "ok" },
      extractPath
    );
    expect(result).toBe(null);
  });
});
