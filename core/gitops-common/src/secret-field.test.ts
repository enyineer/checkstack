import { describe, it, expect } from "bun:test";
import { secretField, isSecretRef, type SecretRef } from "./secret-field";

describe("secretField", () => {
  const schema = secretField();

  it("accepts a plain string value", () => {
    const result = schema.safeParse("my-password");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("my-password");
  });

  it("accepts a secretRef object", () => {
    const result = schema.safeParse({ secretRef: "prod-db-password" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ secretRef: "prod-db-password" });
    }
  });

  it("rejects a number", () => {
    const result = schema.safeParse(42);
    expect(result.success).toBe(false);
  });

  it("rejects an object without secretRef", () => {
    const result = schema.safeParse({ key: "value" });
    expect(result.success).toBe(false);
  });

  it("rejects secretRef with empty name", () => {
    const result = schema.safeParse({ secretRef: "" });
    expect(result.success).toBe(false);
  });
});

describe("isSecretRef", () => {
  it("returns true for a SecretRef object", () => {
    const ref: SecretRef = { secretRef: "my-secret" };
    expect(isSecretRef(ref)).toBe(true);
  });

  it("returns false for a plain string", () => {
    expect(isSecretRef("plain")).toBe(false);
  });

  it("returns false for null", () => {
    expect(isSecretRef(null)).toBe(false);
  });
});
