import { describe, expect, it } from "bun:test";
import {
  createInstanceRuntime,
  instanceNamespaceSchema,
  parseInstanceNamespace,
} from "./instance-runtime";

describe("parseInstanceNamespace", () => {
  it("returns the default (empty) namespace for unset input", () => {
    expect(parseInstanceNamespace(undefined)).toBe("");
    expect(parseInstanceNamespace(null)).toBe("");
    expect(parseInstanceNamespace("")).toBe("");
  });

  it("treats blank / whitespace-only input as the default namespace", () => {
    expect(parseInstanceNamespace("   ")).toBe("");
    expect(parseInstanceNamespace("\t\n")).toBe("");
  });

  it("trims and lowercases a valid namespace", () => {
    expect(parseInstanceNamespace("  Preview  ")).toBe("preview");
    expect(parseInstanceNamespace("PR-380")).toBe("pr-380");
  });

  it("accepts digits, hyphens and a 32-char slug", () => {
    expect(parseInstanceNamespace("preview-123")).toBe("preview-123");
    const max = "a".repeat(32);
    expect(parseInstanceNamespace(max)).toBe(max);
  });

  it("throws on invalid namespaces", () => {
    // leading hyphen
    expect(() => parseInstanceNamespace("-preview")).toThrow();
    // illegal characters
    expect(() => parseInstanceNamespace("preview_1")).toThrow();
    expect(() => parseInstanceNamespace("pre view")).toThrow();
    expect(() => parseInstanceNamespace("preview!")).toThrow();
    // too long (33 chars)
    expect(() => parseInstanceNamespace("a".repeat(33))).toThrow();
  });
});

describe("instanceNamespaceSchema", () => {
  it("accepts the empty string and valid slugs, rejects the rest", () => {
    expect(instanceNamespaceSchema.safeParse("").success).toBe(true);
    expect(instanceNamespaceSchema.safeParse("preview").success).toBe(true);
    expect(instanceNamespaceSchema.safeParse("Preview").success).toBe(false);
    expect(instanceNamespaceSchema.safeParse("a b").success).toBe(false);
  });
});

describe("createInstanceRuntime", () => {
  it("marks the empty namespace as the default instance", () => {
    const runtime = createInstanceRuntime({ namespace: "" });
    expect(runtime.namespace).toBe("");
    expect(runtime.isDefault).toBe(true);
  });

  it("marks a non-empty namespace as a secondary instance", () => {
    const runtime = createInstanceRuntime({ namespace: "preview" });
    expect(runtime.namespace).toBe("preview");
    expect(runtime.isDefault).toBe(false);
  });
});
