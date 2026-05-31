import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  extractReferences,
  resolvePackageTypeClosure,
  typesPackageDirName,
} from "./package-types";

describe("typesPackageDirName", () => {
  test("unscoped name maps to itself", () => {
    expect(typesPackageDirName("lodash")).toBe("lodash");
  });
  test("scoped name mangles @scope/name -> scope__name", () => {
    expect(typesPackageDirName("@babel/core")).toBe("babel__core");
  });
  test("only the first slash is mangled", () => {
    expect(typesPackageDirName("@scope/name")).toBe("scope__name");
  });
});

describe("extractReferences", () => {
  test("captures triple-slash path + types references", () => {
    const refs = extractReferences(
      `/// <reference path="./common/array.d.ts" />\n/// <reference types="node" />`,
    );
    expect(refs).toContainEqual({
      kind: "path",
      target: "./common/array.d.ts",
    });
    expect(refs).toContainEqual({ kind: "types", target: "node" });
  });
  test("captures relative import/export/require, ignores bare", () => {
    const refs = extractReferences(
      [
        `import x from "./sibling";`,
        `export { y } from "../up";`,
        `import _ = require("../index");`,
        `import bare from "lodash";`,
      ].join("\n"),
    );
    const targets = refs.map((r) => r.target);
    expect(targets).toContain("./sibling");
    expect(targets).toContain("../up");
    expect(targets).toContain("../index");
    expect(targets).not.toContain("lodash");
  });
});

describe("resolvePackageTypeClosure", () => {
  let nm: string;
  beforeEach(async () => {
    nm = path.join(
      await mkdtemp(path.join(tmpdir(), "cs-types-")),
      "node_modules",
    );
    await mkdir(nm, { recursive: true });
  });
  afterEach(async () => {
    await rm(path.dirname(nm), { recursive: true, force: true });
  });

  /** Write a file under node_modules at the given relative path. */
  async function file(rel: string, content: string): Promise<void> {
    const full = path.join(nm, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content);
  }

  test("lodash-like: own types absent, @types present, multi-file /// <reference> closure, unwrapped", async () => {
    // lodash itself ships NO own types.
    await file(
      "lodash/package.json",
      JSON.stringify({ name: "lodash", main: "index.js" }),
    );
    await file("lodash/index.js", "module.exports = {};");
    // @types/lodash: index fans out via /// <reference path>.
    await file(
      "@types/lodash/package.json",
      JSON.stringify({ name: "@types/lodash", types: "index.d.ts" }),
    );
    await file(
      "@types/lodash/index.d.ts",
      [
        `/// <reference path="./common/common.d.ts" />`,
        `export = _;`,
        `export as namespace _;`,
        `declare const _: _.LoDashStatic;`,
        `declare namespace _ { interface LoDashStatic {} }`,
      ].join("\n"),
    );
    await file(
      "@types/lodash/common/common.d.ts",
      `import _ = require("../index");\ndeclare module "../index" { interface LoDashStatic { debounce(): void; } }`,
    );

    const closure = await resolvePackageTypeClosure({
      nodeModulesDir: nm,
      specifier: "lodash",
    });

    expect(closure.notFound).toBe(false);
    expect(closure.hasOwnTypes).toBe(false);
    expect(closure.hasAtTypes).toBe(true);
    const paths = closure.files.map((f) => f.path);
    expect(paths).toContain("node_modules/@types/lodash/index.d.ts");
    // The referenced common/common.d.ts must be followed + included.
    expect(paths).toContain("node_modules/@types/lodash/common/common.d.ts");
    // The @types package.json is included so resolution finds the entry.
    expect(paths).toContain("node_modules/@types/lodash/package.json");
    // UNWRAPPED: no `declare module "lodash"` envelope was added.
    const indexFile = closure.files.find(
      (f) => f.path === "node_modules/@types/lodash/index.d.ts",
    );
    expect(indexFile?.content).toContain("export = _;");
    expect(indexFile?.content).not.toContain('declare module "lodash"');
  });

  test("bundled-types (zod/dayjs-like): own index.d.ts present, no @types, returns bundled files (not a 404)", async () => {
    await file(
      "zod/package.json",
      JSON.stringify({ name: "zod", types: "index.d.ts", main: "index.js" }),
    );
    await file("zod/index.d.ts", `export declare function parse(): unknown;`);
    await file("zod/index.js", "module.exports = {};");
    // No @types/zod on purpose.

    const closure = await resolvePackageTypeClosure({
      nodeModulesDir: nm,
      specifier: "zod",
    });

    expect(closure.notFound).toBe(false);
    expect(closure.hasOwnTypes).toBe(true);
    expect(closure.hasAtTypes).toBe(false);
    const paths = closure.files.map((f) => f.path);
    expect(paths).toContain("node_modules/zod/index.d.ts");
    expect(paths).toContain("node_modules/zod/package.json");
  });

  test("bundled-types via exports map `types` condition", async () => {
    await file(
      "dayjs/package.json",
      JSON.stringify({
        name: "dayjs",
        exports: {
          ".": { types: "./esm/index.d.ts", import: "./esm/index.js" },
        },
      }),
    );
    await file(
      "dayjs/esm/index.d.ts",
      `export declare function dayjs(): unknown;`,
    );

    const closure = await resolvePackageTypeClosure({
      nodeModulesDir: nm,
      specifier: "dayjs",
    });

    expect(closure.hasOwnTypes).toBe(true);
    expect(closure.files.map((f) => f.path)).toContain(
      "node_modules/dayjs/esm/index.d.ts",
    );
  });

  test("scoped: @scope/name resolves to @types/scope__name", async () => {
    await file(
      "@babel/core/package.json",
      JSON.stringify({ name: "@babel/core", main: "lib/index.js" }),
    );
    await file("@babel/core/lib/index.js", "module.exports = {};");
    await file(
      "@types/babel__core/package.json",
      JSON.stringify({ name: "@types/babel__core", types: "index.d.ts" }),
    );
    await file(
      "@types/babel__core/index.d.ts",
      `export declare function transform(): unknown;`,
    );

    const closure = await resolvePackageTypeClosure({
      nodeModulesDir: nm,
      specifier: "@babel/core",
    });

    expect(closure.hasAtTypes).toBe(true);
    expect(closure.files.map((f) => f.path)).toContain(
      "node_modules/@types/babel__core/index.d.ts",
    );
  });

  test("both own types AND @types present -> both included", async () => {
    await file(
      "thing/package.json",
      JSON.stringify({ name: "thing", types: "index.d.ts" }),
    );
    await file("thing/index.d.ts", `export const own: number;`);
    await file(
      "@types/thing/package.json",
      JSON.stringify({ name: "@types/thing", types: "index.d.ts" }),
    );
    await file("@types/thing/index.d.ts", `export const fromTypes: string;`);

    const closure = await resolvePackageTypeClosure({
      nodeModulesDir: nm,
      specifier: "thing",
    });

    expect(closure.hasOwnTypes).toBe(true);
    expect(closure.hasAtTypes).toBe(true);
    const paths = closure.files.map((f) => f.path);
    expect(paths).toContain("node_modules/thing/index.d.ts");
    expect(paths).toContain("node_modules/@types/thing/index.d.ts");
  });

  test("neither own types nor @types -> graceful empty closure, no throw", async () => {
    await file(
      "notyped/package.json",
      JSON.stringify({ name: "notyped", main: "index.js" }),
    );
    await file("notyped/index.js", "module.exports = 1;");

    const closure = await resolvePackageTypeClosure({
      nodeModulesDir: nm,
      specifier: "notyped",
    });

    expect(closure.notFound).toBe(true);
    expect(closure.hasOwnTypes).toBe(false);
    expect(closure.hasAtTypes).toBe(false);
    // package.json is still included (harmless), but no .d.ts.
    expect(closure.files.every((f) => !f.path.endsWith(".d.ts"))).toBe(true);
  });

  test("missing package entirely -> notFound, never throws", async () => {
    const closure = await resolvePackageTypeClosure({
      nodeModulesDir: nm,
      specifier: "ghost",
    });
    expect(closure.notFound).toBe(true);
    expect(closure.files).toHaveLength(0);
  });

  test("follows cross-package /// <reference types> into another @types", async () => {
    await file(
      "@types/needsnode/package.json",
      JSON.stringify({ name: "@types/needsnode", types: "index.d.ts" }),
    );
    await file(
      "@types/needsnode/index.d.ts",
      `/// <reference types="node" />\nexport declare const x: number;`,
    );
    await file(
      "@types/node/package.json",
      JSON.stringify({ name: "@types/node", types: "index.d.ts" }),
    );
    await file("@types/node/index.d.ts", `declare const process: unknown;`);
    await file("needsnode/package.json", JSON.stringify({ name: "needsnode" }));

    const closure = await resolvePackageTypeClosure({
      nodeModulesDir: nm,
      specifier: "needsnode",
    });

    expect(closure.files.map((f) => f.path)).toContain(
      "node_modules/@types/node/index.d.ts",
    );
  });

  test("truncated flag set (not silent) when the closure exceeds the ceiling", async () => {
    const big = "x".repeat(2000);
    await file(
      "@types/huge/package.json",
      JSON.stringify({ name: "@types/huge", types: "index.d.ts" }),
    );
    await file(
      "@types/huge/index.d.ts",
      `/// <reference path="./a.d.ts" />\nexport const a: 1;`,
    );
    await file("@types/huge/a.d.ts", `export const big = "${big}";`);
    await file("huge/package.json", JSON.stringify({ name: "huge" }));

    const closure = await resolvePackageTypeClosure({
      nodeModulesDir: nm,
      specifier: "huge",
      maxTotalBytes: 100, // tiny ceiling forces a drop
    });

    expect(closure.truncated).toBe(true);
  });
});
