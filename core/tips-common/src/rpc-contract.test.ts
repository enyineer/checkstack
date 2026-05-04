import { describe, it, expect } from "bun:test";
import {
  LocalTipIdSchema,
  TipIdSchema,
  qualifyTipId,
} from "./rpc-contract";

describe("LocalTipIdSchema", () => {
  it("accepts simple identifiers", () => {
    expect(LocalTipIdSchema.parse("first-run")).toBe("first-run");
    expect(LocalTipIdSchema.parse("systems_create")).toBe("systems_create");
  });

  it("accepts dotted sub-grouping inside the local part", () => {
    expect(LocalTipIdSchema.parse("systems.create.first-time")).toBe(
      "systems.create.first-time",
    );
  });

  it("rejects a leading dot — would let a plugin escape its namespace", () => {
    expect(() => LocalTipIdSchema.parse(".other-plugin.tip")).toThrow();
  });

  it("rejects a trailing dot", () => {
    expect(() => LocalTipIdSchema.parse("systems.")).toThrow();
  });

  it("rejects whitespace and special characters", () => {
    expect(() => LocalTipIdSchema.parse("systems create")).toThrow();
    expect(() => LocalTipIdSchema.parse("systems!create")).toThrow();
    expect(() => LocalTipIdSchema.parse("systems/create")).toThrow();
  });

  it("rejects empty strings", () => {
    expect(() => LocalTipIdSchema.parse("")).toThrow();
  });
});

describe("TipIdSchema (fully qualified)", () => {
  it("requires a namespace separator", () => {
    expect(() => TipIdSchema.parse("no-separator")).toThrow();
  });

  it("accepts well-formed `<plugin>.<local>` IDs", () => {
    expect(TipIdSchema.parse("catalog.systems.create")).toBe(
      "catalog.systems.create",
    );
  });
});

describe("qualifyTipId", () => {
  const catalog = { pluginId: "catalog" };

  it("prefixes the calling plugin's id", () => {
    expect(qualifyTipId(catalog, "systems.create")).toBe(
      "catalog.systems.create",
    );
  });

  it("rejects a local id that tries to escape into another namespace", () => {
    // A malicious plugin trying to silently dismiss someone else's tip:
    // `qualifyTipId({ pluginId: "evil" }, ".healthcheck.first-run")` would,
    // without validation, produce `"evil..healthcheck.first-run"` (still
    // distinct, harmless) — but a leading dot is still rejected so the
    // construction is impossible regardless of intent.
    expect(() => qualifyTipId(catalog, ".healthcheck.first-run")).toThrow();
  });

  it("rejects dangerous separators that could spoof structure", () => {
    expect(() => qualifyTipId(catalog, "../healthcheck/first-run")).toThrow();
  });

  it("returns a value that itself parses as a fully-qualified TipId", () => {
    const id = qualifyTipId(catalog, "systems.create");
    expect(() => TipIdSchema.parse(id)).not.toThrow();
  });
});
