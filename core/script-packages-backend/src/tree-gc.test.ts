import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sweepTreeGc } from "./tree-gc";
import { atomicSymlinkSwap } from "./atomic-symlink";
import { storePaths } from "./data-dir";

const HOUR = 60 * 60 * 1000;

describe("sweepTreeGc", () => {
  let storeRoot: string;

  beforeEach(async () => {
    storeRoot = await mkdtemp(path.join(tmpdir(), "cs-treegc-"));
  });
  afterEach(async () => {
    await rm(storeRoot, { recursive: true, force: true });
  });

  /** Create `trees/<hash>/node_modules` and set its mtime `ageMs` in the past. */
  async function makeTree(hash: string, ageMs: number) {
    const paths = storePaths(storeRoot);
    const dir = path.join(paths.trees, hash);
    await mkdir(path.join(dir, "node_modules"), { recursive: true });
    await writeFile(path.join(dir, "package.json"), "{}");
    const when = new Date(Date.now() - ageMs);
    await utimes(dir, when, when);
    return dir;
  }

  async function exists(dir: string): Promise<boolean> {
    try {
      await stat(dir);
      return true;
    } catch {
      return false;
    }
  }

  async function pointCurrentAt(hash: string) {
    const paths = storePaths(storeRoot);
    await atomicSymlinkSwap({
      linkPath: paths.current,
      target: path.join("trees", hash),
    });
  }

  test("never deletes the current tree, regardless of age", async () => {
    const cur = await makeTree("hashCur", 100 * HOUR); // very old
    await pointCurrentAt("hashCur");

    const res = await sweepTreeGc({ storeRoot, graceMs: HOUR });
    expect(res.currentHash).toBe("hashCur");
    expect(res.deleted).toEqual([]);
    expect(await exists(cur)).toBe(true);
  });

  test("prunes a non-current tree past the grace window", async () => {
    const cur = await makeTree("hashCur", 0);
    const old = await makeTree("hashOld", 5 * HOUR);
    await pointCurrentAt("hashCur");

    const res = await sweepTreeGc({ storeRoot, graceMs: HOUR });
    expect(res.deleted).toEqual(["hashOld"]);
    expect(await exists(old)).toBe(false);
    expect(await exists(cur)).toBe(true);
  });

  test("keeps a non-current tree still within the grace window (live run may be pinned)", async () => {
    const recent = await makeTree("hashRecent", 0.25 * HOUR); // 15 min old
    await makeTree("hashCur", 0);
    await pointCurrentAt("hashCur");

    const res = await sweepTreeGc({ storeRoot, graceMs: HOUR });
    expect(res.deleted).toEqual([]);
    expect(res.keptWithinGrace).toContain("hashRecent");
    expect(await exists(recent)).toBe(true);
  });

  test("respects the grace boundary using the injected clock", async () => {
    await makeTree("hashCur", 0);
    const old = path.join(storePaths(storeRoot).trees, "hashEdge");
    await mkdir(path.join(old, "node_modules"), { recursive: true });
    const when = new Date(Date.now() - 2 * HOUR);
    await utimes(old, when, when);
    await pointCurrentAt("hashCur");

    // now far in the future → well past grace → deleted.
    const res = await sweepTreeGc({
      storeRoot,
      graceMs: HOUR,
      now: Date.now() + 10 * HOUR,
    });
    expect(res.deleted).toContain("hashEdge");
  });

  test("no trees dir → no-op", async () => {
    const res = await sweepTreeGc({ storeRoot, graceMs: HOUR });
    expect(res.deleted).toEqual([]);
    expect(res.keptWithinGrace).toEqual([]);
  });
});
