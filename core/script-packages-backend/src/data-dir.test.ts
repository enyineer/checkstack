import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
  resolveDataDir,
  resolveScriptPackagesDir,
  storePaths,
} from "./data-dir";

describe("resolveDataDir", () => {
  test("uses CHECKSTACK_DATA_DIR when set", () => {
    expect(resolveDataDir({ CHECKSTACK_DATA_DIR: "/srv/cs" })).toBe("/srv/cs");
  });

  test("defaults to .data under cwd when unset", () => {
    expect(resolveDataDir({})).toBe(path.resolve(process.cwd(), ".data"));
  });

  test("ignores a blank value", () => {
    expect(resolveDataDir({ CHECKSTACK_DATA_DIR: "   " })).toBe(
      path.resolve(process.cwd(), ".data"),
    );
  });
});

describe("resolveScriptPackagesDir", () => {
  test("nests script-packages under the data dir", () => {
    expect(resolveScriptPackagesDir({ CHECKSTACK_DATA_DIR: "/srv/cs" })).toBe(
      "/srv/cs/script-packages",
    );
  });
});

describe("storePaths", () => {
  test("derives the cache / trees / current / runs subpaths", () => {
    const p = storePaths("/srv/cs/script-packages");
    expect(p.cache).toBe("/srv/cs/script-packages/cache");
    expect(p.trees).toBe("/srv/cs/script-packages/trees");
    expect(p.current).toBe("/srv/cs/script-packages/current");
    expect(p.runs).toBe("/srv/cs/script-packages/.runs");
  });
});
