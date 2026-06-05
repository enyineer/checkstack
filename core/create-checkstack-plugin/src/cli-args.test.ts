import { describe, it, expect } from "bun:test";
import { parseCliArgs, validateBaseName, validateScope } from "./cli-args";

describe("parseCliArgs", () => {
  it("defaults: latest tag, git on, interactive", () => {
    const args = parseCliArgs({ argv: [] });
    expect(args.versionTag).toBe("latest");
    expect(args.git).toBe(true);
    expect(args.yes).toBe(false);
    expect(args.targetDir).toBeUndefined();
    expect(args.scope).toBeUndefined();
  });

  it("captures the positional target dir", () => {
    expect(parseCliArgs({ argv: ["my-widget"] }).targetDir).toBe("my-widget");
  });

  it("parses --scope / --no-scope", () => {
    expect(parseCliArgs({ argv: ["--scope", "acme"] }).scope).toBe("acme");
    expect(parseCliArgs({ argv: ["--no-scope"] }).scope).toBe("");
  });

  it("parses --version-tag, --no-git, --yes", () => {
    const args = parseCliArgs({
      argv: ["w", "--version-tag", "next", "--no-git", "--yes"],
    });
    expect(args.versionTag).toBe("next");
    expect(args.git).toBe(false);
    expect(args.yes).toBe(true);
    expect(args.targetDir).toBe("w");
  });

  it("registry flag overrides the env fallback", () => {
    const args = parseCliArgs({
      argv: ["--registry", "http://localhost:4873"],
      env: { CHECKSTACK_SCAFFOLD_REGISTRY: "http://env:1111" },
    });
    expect(args.registry).toBe("http://localhost:4873");
  });

  it("falls back to CHECKSTACK_SCAFFOLD_REGISTRY when no flag given", () => {
    const args = parseCliArgs({
      argv: [],
      env: { CHECKSTACK_SCAFFOLD_REGISTRY: "http://env:1111" },
    });
    expect(args.registry).toBe("http://env:1111");
  });
});

describe("validateBaseName", () => {
  it("accepts a kebab base name", () => {
    expect(validateBaseName("my-widget").valid).toBe(true);
  });
  it("rejects uppercase, reserved, and bad shapes", () => {
    expect(validateBaseName("Widget").valid).toBe(false);
    expect(validateBaseName("common").valid).toBe(false);
    expect(validateBaseName("-x").valid).toBe(false);
    expect(validateBaseName("a--b").valid).toBe(false);
  });
});

describe("validateScope", () => {
  it("accepts empty (unscoped) and valid scopes", () => {
    expect(validateScope("").valid).toBe(true);
    expect(validateScope("acme").valid).toBe(true);
    expect(validateScope("my-org").valid).toBe(true);
  });
  it("rejects a leading @ or uppercase", () => {
    expect(validateScope("@acme").valid).toBe(false);
    expect(validateScope("Acme").valid).toBe(false);
  });
});
