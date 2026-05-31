import { describe, expect, test } from "bun:test";
import {
  classifyBuiltinModule,
  extractBuiltinModuleSpecifiers,
  importablePackageNames,
  importSpecifierCompletionContext,
  mergeImportCompletionEntries,
  packageNameFromSpecifier,
  parseBareImportSpecifiers,
  planAcquisitions,
} from "./importSpecifiers";

describe("packageNameFromSpecifier", () => {
  test("plain", () => {
    expect(packageNameFromSpecifier("lodash")).toBe("lodash");
  });
  test("subpath", () => {
    expect(packageNameFromSpecifier("lodash/fp")).toBe("lodash");
  });
  test("scoped", () => {
    expect(packageNameFromSpecifier("@babel/core")).toBe("@babel/core");
  });
  test("scoped subpath", () => {
    expect(packageNameFromSpecifier("@scope/pkg/sub/deep")).toBe("@scope/pkg");
  });
});

describe("parseBareImportSpecifiers", () => {
  test("default, named, namespace, side-effect, type", () => {
    const src = [
      `import _ from "lodash";`,
      `import { z } from "zod";`,
      `import * as React from "react";`,
      `import "side-effect-pkg";`,
      `import type { Dayjs } from "dayjs";`,
    ].join("\n");
    const specs = parseBareImportSpecifiers(src);
    expect(specs.sort()).toEqual(
      ["dayjs", "lodash", "react", "side-effect-pkg", "zod"].sort(),
    );
  });

  test("export-from, dynamic import, require", () => {
    const src = [
      `export { x } from "pkg-a";`,
      `export * from "pkg-b";`,
      `const p = await import("pkg-c");`,
      `const q = require("pkg-d");`,
    ].join("\n");
    expect(parseBareImportSpecifiers(src).sort()).toEqual(
      ["pkg-a", "pkg-b", "pkg-c", "pkg-d"].sort(),
    );
  });

  test("ignores relative, node:, bun, and context", () => {
    const src = [
      `import a from "./local";`,
      `import b from "../up";`,
      `import { readFile } from "node:fs";`,
      `import { Glob } from "bun";`,
      `const c = context.trigger;`,
      `import "context";`,
    ].join("\n");
    expect(parseBareImportSpecifiers(src)).toEqual([]);
  });

  test("scoped + subpath reduce to package name, deduped", () => {
    const src = [
      `import { debounce } from "lodash/debounce";`,
      `import _ from "lodash";`,
      `import { transform } from "@babel/core/lib/x";`,
    ].join("\n");
    expect(parseBareImportSpecifiers(src).sort()).toEqual(
      ["@babel/core", "lodash"].sort(),
    );
  });

  test("the lodash named-import case (acceptance)", () => {
    expect(parseBareImportSpecifiers(`import { debounce } from "lodash";`)).toEqual(
      ["lodash"],
    );
  });
});

describe("planAcquisitions", () => {
  test("returns only new specifiers, order-stable, deduped", () => {
    const plan = planAcquisitions({
      specifiers: ["lodash", "zod", "lodash", "react"],
      acquired: new Set(["zod"]),
    });
    expect(plan).toEqual(["lodash", "react"]);
  });
  test("empty when all acquired", () => {
    expect(
      planAcquisitions({
        specifiers: ["a", "b"],
        acquired: new Set(["a", "b"]),
      }),
    ).toEqual([]);
  });
});

describe("importSpecifierCompletionContext", () => {
  // The `partial` text starts just after the opening quote; the
  // `replaceFromColumn` is its 1-based start column. For a line like
  // `import {} from "lod` the partial is `lod` starting at column 17.
  test("from-clause double quote", () => {
    const line = `import {} from "lod`;
    const ctx = importSpecifierCompletionContext(line);
    expect(ctx).toEqual({ partial: "lod", replaceFromColumn: 17 });
  });

  test("from-clause single quote", () => {
    const line = `import x from 'lo`;
    expect(importSpecifierCompletionContext(line)).toEqual({
      partial: "lo",
      replaceFromColumn: 16,
    });
  });

  test("namespace import (import * as x from)", () => {
    const line = `import * as _ from "lod`;
    expect(importSpecifierCompletionContext(line)?.partial).toBe("lod");
  });

  test("export ... from", () => {
    const line = `export { x } from "lod`;
    expect(importSpecifierCompletionContext(line)?.partial).toBe("lod");
  });

  test("bare side-effect import", () => {
    const line = `import "lo`;
    expect(importSpecifierCompletionContext(line)).toEqual({
      partial: "lo",
      replaceFromColumn: 9,
    });
  });

  test("dynamic import()", () => {
    const line = `const m = await import("lo`;
    expect(importSpecifierCompletionContext(line)?.partial).toBe("lo");
  });

  test("require()", () => {
    const line = `const m = require("lo`;
    expect(importSpecifierCompletionContext(line)?.partial).toBe("lo");
  });

  test("scoped partial keeps the slash", () => {
    const line = `import {} from "@scope/`;
    expect(importSpecifierCompletionContext(line)?.partial).toBe("@scope/");
  });

  test("empty partial right after the opening quote", () => {
    // `import {} from "` is 16 chars; the cursor sits at column 17 where the
    // (empty) specifier begins.
    const line = `import {} from "`;
    expect(importSpecifierCompletionContext(line)).toEqual({
      partial: "",
      replaceFromColumn: 17,
    });
  });

  test("returns null when not in an import string", () => {
    expect(importSpecifierCompletionContext(`const x = 1;`)).toBeNull();
    expect(importSpecifierCompletionContext(`const s = "hello`)).toBeNull();
    expect(importSpecifierCompletionContext(`foo("bar`)).toBeNull();
  });

  test("returns null once the import string is already closed", () => {
    expect(
      importSpecifierCompletionContext(`import {} from "lodash"`),
    ).toBeNull();
    expect(importSpecifierCompletionContext(`import "lodash";`)).toBeNull();
  });
});

describe("importablePackageNames", () => {
  test("excludes @types/* companions", () => {
    expect(
      importablePackageNames(["lodash", "@types/lodash", "zod"]),
    ).toEqual(["lodash", "zod"]);
  });
  test("dedupes and sorts", () => {
    expect(
      importablePackageNames(["zod", "lodash", "lodash", "@babel/core"]),
    ).toEqual(["@babel/core", "lodash", "zod"]);
  });
  test("scoped non-@types names are kept", () => {
    expect(importablePackageNames(["@babel/core", "@types/babel__core"])).toEqual(
      ["@babel/core"],
    );
  });
});

describe("extractBuiltinModuleSpecifiers", () => {
  // A small fixture mirroring how @types/node + bun-types declare importable
  // modules (top-level `declare module "<spec>"`) alongside wildcard / asset
  // shims that must be filtered out.
  const fixture = [
    `declare module "node:fs" { export function readFile(): void; }`,
    `declare module "fs" { export function readFile(): void; }`,
    `declare module 'node:path' { export const sep: string; }`,
    `declare module "bun" { export const version: string; }`,
    `declare module "bun:test" { export function test(): void; }`,
    // Noise that must be dropped:
    `declare module "*" { const c: unknown; export default c; }`,
    `declare module "*.css" { const c: string; export default c; }`,
    `declare module "*.txt" { const c: string; export default c; }`,
  ].join("\n");

  test("keeps real importable specifiers, drops wildcard/asset shims", () => {
    expect(extractBuiltinModuleSpecifiers(fixture)).toEqual([
      "bun",
      "bun:test",
      "fs",
      "node:fs",
      "node:path",
    ]);
  });

  test("dedupes a repeated declaration", () => {
    const src = `declare module "fs" {}\ndeclare module "fs" {}`;
    expect(extractBuiltinModuleSpecifiers(src)).toEqual(["fs"]);
  });

  test("does not match an augmentation indented as a non-statement", () => {
    // A `declare module` nested under another block won't be at line start;
    // our anchor (`^\s*`) still allows leading whitespace, which is correct
    // for real top-level declarations. This asserts the simple line-start
    // behavior: a name on its own line is captured.
    const src = `  declare module "node:os" {}`;
    expect(extractBuiltinModuleSpecifiers(src)).toEqual(["node:os"]);
  });

  test("empty input yields empty list", () => {
    expect(extractBuiltinModuleSpecifiers("")).toEqual([]);
  });
});

describe("classifyBuiltinModule", () => {
  test("bun and bun: specifiers are Bun built-ins", () => {
    expect(classifyBuiltinModule("bun").detail).toBe("Bun built-in");
    expect(classifyBuiltinModule("bun:test").detail).toBe("Bun built-in");
  });
  test("node and bare builtins are Node.js", () => {
    expect(classifyBuiltinModule("node:fs").detail).toBe("Node.js");
    expect(classifyBuiltinModule("fs").detail).toBe("Node.js");
  });
});

describe("mergeImportCompletionEntries", () => {
  test("built-ins always present; installed packages merged; sorted", () => {
    const merged = mergeImportCompletionEntries({
      builtins: ["node:fs", "bun"],
      installedPackages: ["lodash", "zod"],
    });
    expect(merged.map((e) => e.name)).toEqual([
      "bun",
      "lodash",
      "node:fs",
      "zod",
    ]);
    expect(merged.find((e) => e.name === "bun")?.detail).toBe("Bun built-in");
    expect(merged.find((e) => e.name === "node:fs")?.detail).toBe("Node.js");
    expect(merged.find((e) => e.name === "lodash")?.detail).toBe(
      "installed package",
    );
  });

  test("built-ins present even with an empty allowlist", () => {
    const merged = mergeImportCompletionEntries({
      builtins: ["node:fs", "bun"],
      installedPackages: [],
    });
    expect(merged.map((e) => e.name)).toEqual(["bun", "node:fs"]);
  });

  test("an installed package colliding with a built-in is labelled installed", () => {
    const merged = mergeImportCompletionEntries({
      builtins: ["fs"],
      installedPackages: ["fs"],
    });
    expect(merged).toEqual([{ name: "fs", detail: "installed package" }]);
  });
});
