import { describe, expect, test } from "bun:test";
import {
  DEFAULT_BLOCK_BYTES,
  DEFAULT_WARN_BYTES,
  PackageNameSchema,
  PackageVersionSchema,
  RegistryConfigSchema,
  SizeCapConfigSchema,
} from "./schemas";

describe("PackageNameSchema", () => {
  test("accepts plain and scoped names", () => {
    expect(PackageNameSchema.safeParse("lodash").success).toBe(true);
    expect(PackageNameSchema.safeParse("@acme/utils").success).toBe(true);
  });
  test("rejects uppercase / invalid names", () => {
    expect(PackageNameSchema.safeParse("Lodash").success).toBe(false);
    expect(PackageNameSchema.safeParse("../evil").success).toBe(false);
  });
});

describe("PackageVersionSchema", () => {
  test("accepts exact versions and rejects ranges", () => {
    expect(PackageVersionSchema.safeParse("4.17.21").success).toBe(true);
    expect(PackageVersionSchema.safeParse("1.0.0-beta.1").success).toBe(true);
    expect(PackageVersionSchema.safeParse("^4.17.0").success).toBe(false);
    expect(PackageVersionSchema.safeParse("latest").success).toBe(false);
  });
});

describe("RegistryConfigSchema", () => {
  test("ignoreScripts defaults to true (RCE mitigation)", () => {
    const cfg = RegistryConfigSchema.parse({});
    expect(cfg.ignoreScripts).toBe(true);
    expect(cfg.hasAuthToken).toBe(false);
    expect(cfg.registryUrl).toBe("https://registry.npmjs.org/");
  });
});

describe("SizeCapConfigSchema", () => {
  test("defaults to 150MB warn / 300MB block", () => {
    const cap = SizeCapConfigSchema.parse({});
    expect(cap.warnBytes).toBe(DEFAULT_WARN_BYTES);
    expect(cap.blockBytes).toBe(DEFAULT_BLOCK_BYTES);
    expect(DEFAULT_WARN_BYTES).toBe(150 * 1024 * 1024);
    expect(DEFAULT_BLOCK_BYTES).toBe(300 * 1024 * 1024);
  });
});
