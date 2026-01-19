import { describe, expect, it } from "bun:test";
import { z } from "zod";
import {
  healthResultSchema,
  healthResultNumber,
  healthResultString,
  healthResultJSONPath,
  stripEphemeralFields,
  getHealthResultMeta,
} from "./zod-health-result";

describe("stripEphemeralFields", () => {
  it("should strip fields marked with x-ephemeral", () => {
    const schema = healthResultSchema({
      statusCode: healthResultNumber({ "x-chart-type": "counter" }),
      body: healthResultJSONPath({ "x-ephemeral": true }), // Explicitly marked ephemeral
    });

    const result = {
      statusCode: 200,
      body: '{"large":"response body that should not be stored"}',
    };

    const stripped = stripEphemeralFields(result, schema);

    expect(stripped).toEqual({ statusCode: 200 });
    expect(stripped).not.toHaveProperty("body");
  });

  it("should preserve non-ephemeral fields", () => {
    const schema = healthResultSchema({
      responseTimeMs: healthResultNumber({ "x-chart-type": "line" }),
      statusText: healthResultString({ "x-chart-type": "text" }),
    });

    const result = {
      responseTimeMs: 150,
      statusText: "OK",
    };

    const stripped = stripEphemeralFields(result, schema);

    expect(stripped).toEqual(result);
  });

  it("should preserve unknown fields like _collectorId", () => {
    const schema = healthResultSchema({
      value: healthResultNumber({ "x-chart-type": "counter" }),
      body: healthResultJSONPath({ "x-ephemeral": true }),
    });

    const result = {
      _collectorId: "http.request",
      _assertionFailed: undefined,
      value: 42,
      body: "large body content",
    };

    const stripped = stripEphemeralFields(result, schema);

    expect(stripped).toEqual({
      _collectorId: "http.request",
      _assertionFailed: undefined,
      value: 42,
    });
  });

  it("should return original result for non-ZodObject schemas", () => {
    const schema = z.string();
    const result = { foo: "bar" };

    const stripped = stripEphemeralFields(result, schema);

    expect(stripped).toEqual(result);
  });

  it("should handle empty result objects", () => {
    const schema = healthResultSchema({
      body: healthResultJSONPath({ "x-ephemeral": true }),
    });

    const result = {};
    const stripped = stripEphemeralFields(result, schema);

    expect(stripped).toEqual({});
  });
});

describe("healthResultJSONPath", () => {
  it("should allow explicitly marking fields as ephemeral", () => {
    const field = healthResultJSONPath({ "x-ephemeral": true });
    const meta = getHealthResultMeta(field);

    expect(meta?.["x-ephemeral"]).toBe(true);
    expect(meta?.["x-jsonpath"]).toBe(true);
  });

  it("should not be ephemeral by default", () => {
    const field = healthResultJSONPath({});
    const meta = getHealthResultMeta(field);

    expect(meta?.["x-ephemeral"]).toBeUndefined();
    expect(meta?.["x-jsonpath"]).toBe(true);
  });
});
