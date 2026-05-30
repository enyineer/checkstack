import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sweepTreeGc } from "./tree-gc";
import { atomicSymlinkSwap } from "./atomic-symlink";
import { storePaths } from "./data-dir";
import { RETIRED_AT_MARKER } from "./tree-retirement";

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

  /** Stamp a `.retired-at` marker `ageMs` in the past onto a tree dir. */
  async function retireTree(hash: string, ageMs: number) {
    const dir = path.join(storePaths(storeRoot).trees, hash);
    await writeFile(
      path.join(dir, RETIRED_AT_MARKER),
      `${Date.now() - ageMs}\n`,
    );
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

  test("prunes a non-current tree retired past the grace window", async () => {
    const cur = await makeTree("hashCur", 0);
    const old = await makeTree("hashOld", 100 * HOUR); // ancient mtime
    await retireTree("hashOld", 5 * HOUR); // but retired 5h ago > grace
    await pointCurrentAt("hashCur");

    const res = await sweepTreeGc({ storeRoot, graceMs: HOUR });
    expect(res.deleted).toEqual(["hashOld"]);
    expect(await exists(old)).toBe(false);
    expect(await exists(cur)).toBe(true);
  });

  test("keeps a non-current tree still within the grace window (live run may be pinned)", async () => {
    const recent = await makeTree("hashRecent", 100 * HOUR); // ancient mtime
    await retireTree("hashRecent", 0.25 * HOUR); // retired 15 min ago < grace
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
    await retireTree("hashEdge", 2 * HOUR);
    await pointCurrentAt("hashCur");

    // now far in the future → well past grace-since-retirement → deleted.
    const res = await sweepTreeGc({
      storeRoot,
      graceMs: HOUR,
      now: Date.now() + 10 * HOUR,
    });
    expect(res.deleted).toContain("hashEdge");
  });

  test("back-fills a marker for an unmarked non-current tree and retains it that pass", async () => {
    await makeTree("hashCur", 0);
    const orphan = await makeTree("hashOrphan", 100 * HOUR); // ancient, no marker
    await pointCurrentAt("hashCur");

    // First pass: no retirement marker → retained + back-filled.
    const first = await sweepTreeGc({ storeRoot, graceMs: HOUR });
    expect(first.deleted).toEqual([]);
    expect(first.keptWithinGrace).toContain("hashOrphan");
    expect(await exists(orphan)).toBe(true);
    expect(await exists(path.join(orphan, RETIRED_AT_MARKER))).toBe(true);

    // A later pass past grace (from the back-filled time) deletes it.
    const later = await sweepTreeGc({
      storeRoot,
      graceMs: HOUR,
      now: Date.now() + 10 * HOUR,
    });
    expect(later.deleted).toContain("hashOrphan");
    expect(await exists(orphan)).toBe(false);
  });

  test("no trees dir → no-op", async () => {
    const res = await sweepTreeGc({ storeRoot, graceMs: HOUR });
    expect(res.deleted).toEqual([]);
    expect(res.keptWithinGrace).toEqual([]);
  });

  // ── H3 regression: grace must key on RETIREMENT time, not materialize mtime ──
  //
  // A tree that was `current` for days has an old mtime. The instant it is
  // superseded by a flip it would (under the old mtime-keyed logic) be
  // INSTANTLY eligible — and sweepTreeGc runs right after a flip, so it would
  // delete a tree an in-flight run is still pinned to. The grace window must
  // start ticking from when the tree BECAME non-current, not from its mtime.

  test("retains a long-current tree the instant it is superseded by a flip", async () => {
    // Tree A has been current for ~days (very old mtime).
    const treeA = await makeTree("hashA", 100 * HOUR);
    // Tree B has just been materialized.
    await makeTree("hashB", 0);

    // Flip current A -> ... -> B (A becomes non-current right now).
    await pointCurrentAt("hashA");
    await pointCurrentAt("hashB");

    // Immediately sweep. A's mtime is ancient, but it only just retired, so it
    // MUST be retained (a run started before the flip is still pinned to it).
    const res = await sweepTreeGc({ storeRoot, graceMs: HOUR });
    expect(res.currentHash).toBe("hashB");
    expect(res.deleted).toEqual([]);
    expect(res.keptWithinGrace).toContain("hashA");
    expect(await exists(treeA)).toBe(true);
  });

  test("deletes a superseded tree only once grace-since-RETIREMENT elapses", async () => {
    const treeA = await makeTree("hashA", 100 * HOUR);
    await makeTree("hashB", 0);
    await pointCurrentAt("hashA");
    await pointCurrentAt("hashB"); // A retires now

    // Within grace from retirement → retained.
    const within = await sweepTreeGc({ storeRoot, graceMs: HOUR });
    expect(within.deleted).toEqual([]);
    expect(await exists(treeA)).toBe(true);

    // Well past grace from retirement (injected clock) → deleted.
    const after = await sweepTreeGc({
      storeRoot,
      graceMs: HOUR,
      now: Date.now() + 10 * HOUR,
    });
    expect(after.deleted).toContain("hashA");
    expect(await exists(treeA)).toBe(false);
  });
});
