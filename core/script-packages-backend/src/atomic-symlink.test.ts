import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { atomicSymlinkSwap, readCurrentTarget } from "./atomic-symlink";

describe("atomicSymlinkSwap", () => {
  let work: string;
  beforeEach(async () => {
    work = await mkdtemp(path.join(tmpdir(), "cs-symlink-"));
  });
  afterEach(async () => {
    await rm(work, { recursive: true, force: true });
  });

  test("points current at a tree and resolves files through it", async () => {
    const treeA = path.join(work, "trees", "hashA");
    await mkdir(treeA, { recursive: true });
    await writeFile(path.join(treeA, "marker"), "A");
    const current = path.join(work, "current");

    await atomicSymlinkSwap({ linkPath: current, target: "trees/hashA" });
    expect(await readCurrentTarget(current)).toBe("trees/hashA");
    expect(await readFile(path.join(current, "marker"), "utf8")).toBe("A");
  });

  test("re-points an existing current to a new tree atomically", async () => {
    const treeA = path.join(work, "trees", "hashA");
    const treeB = path.join(work, "trees", "hashB");
    await mkdir(treeA, { recursive: true });
    await mkdir(treeB, { recursive: true });
    await writeFile(path.join(treeA, "marker"), "A");
    await writeFile(path.join(treeB, "marker"), "B");
    const current = path.join(work, "current");

    await atomicSymlinkSwap({ linkPath: current, target: "trees/hashA" });
    await atomicSymlinkSwap({ linkPath: current, target: "trees/hashB" });
    expect(await readCurrentTarget(current)).toBe("trees/hashB");
    expect(await readFile(path.join(current, "marker"), "utf8")).toBe("B");
  });

  test("readCurrentTarget returns undefined when absent", async () => {
    expect(
      await readCurrentTarget(path.join(work, "nope")),
    ).toBeUndefined();
  });
});
