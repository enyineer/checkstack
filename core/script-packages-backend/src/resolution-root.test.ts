import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveResolutionRoot } from "./resolution-root";
import { storePaths } from "./data-dir";

describe("resolveResolutionRoot", () => {
  let storeRoot: string;

  beforeEach(async () => {
    storeRoot = path.join(await mkdtemp(path.join(tmpdir(), "cs-resroot-")), "store");
    await mkdir(storeRoot, { recursive: true });
  });
  afterEach(async () => {
    await rm(path.dirname(storeRoot), { recursive: true, force: true });
  });

  async function materialize(hash: string) {
    const paths = storePaths(storeRoot);
    await mkdir(path.join(paths.trees, hash, "node_modules"), {
      recursive: true,
    });
    await symlink(path.join("trees", hash), paths.current);
  }

  test("returns mode:none when no packages are configured", async () => {
    const res = await resolveResolutionRoot({
      desiredLockfileHash: null,
      storeRoot,
    });
    expect(res.mode).toBe("none");
  });

  test("returns mode:ready with the current path when materialized", async () => {
    await materialize("hash-1");
    const res = await resolveResolutionRoot({
      desiredLockfileHash: "hash-1",
      storeRoot,
    });
    expect(res.mode).toBe("ready");
    if (res.mode === "ready") {
      expect(res.root).toBe(storePaths(storeRoot).current);
    }
  });

  test("returns mode:notReady when packages desired but nothing materialized", async () => {
    const res = await resolveResolutionRoot({
      desiredLockfileHash: "hash-1",
      storeRoot,
      hostLabel: "satellite",
    });
    expect(res.mode).toBe("notReady");
    if (res.mode === "notReady") {
      expect(res.reason).toContain("not ready on this satellite");
      expect(res.reason).toContain("none materialized");
    }
  });

  test("returns mode:notReady when current points at a DIFFERENT hash", async () => {
    await materialize("old-hash");
    const res = await resolveResolutionRoot({
      desiredLockfileHash: "new-hash",
      storeRoot,
    });
    expect(res.mode).toBe("notReady");
    if (res.mode === "notReady") {
      expect(res.reason).toContain("have old-hash");
    }
  });

  test("returns mode:notReady when current exists but the tree lacks node_modules", async () => {
    const paths = storePaths(storeRoot);
    await mkdir(path.join(paths.trees, "hash-1"), { recursive: true });
    await symlink(path.join("trees", "hash-1"), paths.current);
    const res = await resolveResolutionRoot({
      desiredLockfileHash: "hash-1",
      storeRoot,
    });
    expect(res.mode).toBe("notReady");
  });
});
