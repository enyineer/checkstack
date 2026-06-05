import { describe, expect, it } from "bun:test";

import {
  deriveClientFieldErrors,
  deriveServerFieldErrors,
  parseServerValidationData,
  omitKeepExistingSecrets,
  listSecretFieldKeys,
} from "./validation.logic";
import type { JsonSchema } from "./types";

const connectionSchema: JsonSchema = {
  type: "object",
  required: ["apiKey", "baseUrl"],
  properties: {
    apiKey: { type: "string", "x-secret": true },
    baseUrl: { type: "string" },
    organization: { type: "string" },
    spendCap: {
      type: "object",
      required: ["tokenBudget"],
      properties: {
        tokenBudget: { type: "number" },
      },
    },
  },
};

describe("deriveClientFieldErrors", () => {
  it("flags empty required fields", () => {
    const errors = deriveClientFieldErrors({
      schema: connectionSchema,
      value: { apiKey: "", baseUrl: undefined },
    });
    expect(errors.apiKey).toBeDefined();
    expect(errors.baseUrl).toBeDefined();
    expect(errors.apiKey).toContain("required");
  });

  it("returns no error for filled required fields", () => {
    const errors = deriveClientFieldErrors({
      schema: connectionSchema,
      value: { apiKey: "sk-123", baseUrl: "https://api.example.com" },
    });
    expect(errors.apiKey).toBeUndefined();
    expect(errors.baseUrl).toBeUndefined();
  });

  it("never flags optional empty fields", () => {
    const errors = deriveClientFieldErrors({
      schema: connectionSchema,
      value: { apiKey: "sk-123", baseUrl: "https://x", organization: "" },
    });
    expect(errors.organization).toBeUndefined();
  });

  it("skips required fields hidden by x-hidden", () => {
    const schema: JsonSchema = {
      type: "object",
      required: ["connectionId"],
      properties: { connectionId: { type: "string", "x-hidden": true } },
    };
    const errors = deriveClientFieldErrors({ schema, value: {} });
    expect(errors.connectionId).toBeUndefined();
  });

  it("skips required fields hidden by x-hidden-when", () => {
    const schema: JsonSchema = {
      type: "object",
      required: ["token"],
      properties: {
        mode: { type: "string" },
        token: { type: "string", "x-hidden-when": { mode: ["anonymous"] } },
      },
    };
    const errors = deriveClientFieldErrors({
      schema,
      value: { mode: "anonymous" },
    });
    expect(errors.token).toBeUndefined();
  });

  it("flags a required nested object whose required child is empty", () => {
    const errors = deriveClientFieldErrors({
      schema: { ...connectionSchema, required: ["spendCap"] },
      value: { spendCap: {} },
    });
    expect(errors.spendCap).toBeDefined();
  });

  it("returns an empty map for a schema with no properties", () => {
    const errors = deriveClientFieldErrors({
      schema: { type: "object" },
      value: {},
    });
    expect(errors).toEqual({});
  });

  it("edit + blank x-secret + existing secret => valid (no required error)", () => {
    const errors = deriveClientFieldErrors({
      schema: connectionSchema,
      value: { apiKey: "", baseUrl: "https://api.example.com" },
      keepExistingSecretFields: ["apiKey"],
    });
    expect(errors.apiKey).toBeUndefined();
    expect(errors.baseUrl).toBeUndefined();
    expect(Object.keys(errors)).toHaveLength(0);
  });

  it("create + blank x-secret => required error", () => {
    const errors = deriveClientFieldErrors({
      schema: connectionSchema,
      value: { apiKey: "", baseUrl: "https://api.example.com" },
      keepExistingSecretFields: [],
    });
    expect(errors.apiKey).toBeDefined();
  });

  it("edit + blank x-secret + no existing secret for that field => required error", () => {
    // apiKey was never set, so it is NOT in keepExistingSecretFields.
    const errors = deriveClientFieldErrors({
      schema: connectionSchema,
      value: { apiKey: "", baseUrl: "https://api.example.com" },
      keepExistingSecretFields: ["someOtherSecret"],
    });
    expect(errors.apiKey).toBeDefined();
  });

  it("does not exempt a blank NON-secret required field via keepExisting", () => {
    const errors = deriveClientFieldErrors({
      schema: connectionSchema,
      value: { apiKey: "sk-1", baseUrl: "" },
      keepExistingSecretFields: ["baseUrl"],
    });
    // baseUrl is not x-secret, so the keep-existing exemption must not apply.
    expect(errors.baseUrl).toBeDefined();
  });
});

describe("listSecretFieldKeys", () => {
  it("lists only x-secret field keys", () => {
    expect(listSecretFieldKeys(connectionSchema)).toEqual(["apiKey"]);
  });

  it("returns an empty list when there are no secret fields", () => {
    expect(listSecretFieldKeys({ type: "object", properties: {} })).toEqual([]);
  });
});

describe("omitKeepExistingSecrets", () => {
  it("strips a blank keep-existing secret so it is not sent on submit", () => {
    const result = omitKeepExistingSecrets({
      schema: connectionSchema,
      value: { apiKey: "", baseUrl: "https://x", organization: "acme" },
      keepExistingSecretFields: ["apiKey"],
    });
    expect("apiKey" in result).toBe(false);
    expect(result.baseUrl).toBe("https://x");
    expect(result.organization).toBe("acme");
  });

  it("keeps a freshly-typed secret value", () => {
    const result = omitKeepExistingSecrets({
      schema: connectionSchema,
      value: { apiKey: "sk-new", baseUrl: "https://x" },
      keepExistingSecretFields: ["apiKey"],
    });
    expect(result.apiKey).toBe("sk-new");
  });

  it("strips nothing on create (empty keep-existing list)", () => {
    const value = { apiKey: "", baseUrl: "https://x" };
    const result = omitKeepExistingSecrets({
      schema: connectionSchema,
      value,
      keepExistingSecretFields: [],
    });
    expect(result).toEqual(value);
  });
});

describe("parseServerValidationData", () => {
  it("parses a well-formed config-validation payload", () => {
    const parsed = parseServerValidationData({
      code: "CONFIG_VALIDATION",
      issues: [{ path: ["apiKey"], message: "Required" }],
    });
    expect(parsed?.issues).toHaveLength(1);
  });

  it("returns undefined for an unrelated payload", () => {
    expect(parseServerValidationData(undefined)).toBeUndefined();
    expect(parseServerValidationData({ code: "OTHER" })).toBeUndefined();
    expect(parseServerValidationData("boom")).toBeUndefined();
  });
});

describe("deriveServerFieldErrors", () => {
  it("maps issues with a known top-level path", () => {
    const { mapped, unmapped } = deriveServerFieldErrors({
      schema: connectionSchema,
      issues: [{ path: ["apiKey"], message: "API key is invalid" }],
    });
    expect(mapped.apiKey).toBe("API key is invalid");
    expect(unmapped).toHaveLength(0);
  });

  it("maps nested paths with dot notation", () => {
    const { mapped } = deriveServerFieldErrors({
      schema: connectionSchema,
      issues: [
        { path: ["spendCap", "tokenBudget"], message: "Must be positive" },
      ],
    });
    expect(mapped["spendCap.tokenBudget"]).toBe("Must be positive");
  });

  it("falls back unmapped issues whose root is unknown", () => {
    const { mapped, unmapped } = deriveServerFieldErrors({
      schema: connectionSchema,
      issues: [{ path: ["nonexistent"], message: "Surprise" }],
    });
    expect(Object.keys(mapped)).toHaveLength(0);
    expect(unmapped).toEqual(["Surprise"]);
  });

  it("treats an empty path as unmappable", () => {
    const { mapped, unmapped } = deriveServerFieldErrors({
      schema: connectionSchema,
      issues: [{ path: [], message: "Whole object is wrong" }],
    });
    expect(Object.keys(mapped)).toHaveLength(0);
    expect(unmapped).toEqual(["Whole object is wrong"]);
  });

  it("keeps the first message when a path repeats", () => {
    const { mapped } = deriveServerFieldErrors({
      schema: connectionSchema,
      issues: [
        { path: ["apiKey"], message: "First" },
        { path: ["apiKey"], message: "Second" },
      ],
    });
    expect(mapped.apiKey).toBe("First");
  });

  it("returns empty maps for no issues", () => {
    const { mapped, unmapped } = deriveServerFieldErrors({
      schema: connectionSchema,
      issues: [],
    });
    expect(mapped).toEqual({});
    expect(unmapped).toEqual([]);
  });
});
