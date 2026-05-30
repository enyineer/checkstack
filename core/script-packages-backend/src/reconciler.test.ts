import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ManifestEntry } from "@checkstack/script-packages-common";
import { reconcileToHash, type ReconcileDeps } from "./reconciler";
import { createReconcileFsDeps } from "./reconcile-fs";
import { packDir } from "./cache-archive";
import { blobSha256 } from "./blob-hash";
import { storePaths } from "./data-dir";

const a: ManifestEntry = { name: "a", version: "1.0.0", integrity: "sha-a" };
const b: ManifestEntry = { name: "b", version: "2.0.0", integrity: "sha-b" };

function makeDeps(overrides: Partial<ReconcileDeps> = {}): {
  deps: ReconcileDeps;
  fetched: string[];
  seeded: string[];
  materialized: string[];
} {
  const fetched: string[] = [];
  const seeded: string[] = [];
  const materialized: string[] = [];
  const deps: ReconcileDeps = {
    currentLockfileHash: async () => undefined,
    localCacheIntegrities: async () => [],
    fetchBlob: async ({ integrity }) => {
      fetched.push(integrity);
      return new Uint8Array([1]);
    },
    seedBlob: async ({ entry }) => {
      seeded.push(entry.integrity);
    },
    materializeAndFlip: async ({ lockfileHash }) => {
      materialized.push(lockfileHash);
    },
    ...overrides,
  };
  return { deps, fetched, seeded, materialized };
}

describe("reconcileToHash", () => {
  test("pulls only missing blobs, then materializes + flips", async () => {
    const { deps, fetched, seeded, materialized } = makeDeps({
      localCacheIntegrities: async () => ["sha-a"],
    });
    const res = await reconcileToHash({
      lockfileHash: "HASH1",
      manifest: [a, b],
      deps,
    });
    expect(fetched).toEqual(["sha-b"]); // delta
    expect(seeded).toEqual(["sha-b"]);
    expect(materialized).toEqual(["HASH1"]);
    expect(res.alreadyConverged).toBe(false);
    expect(res.pulledIntegrities).toEqual(["sha-b"]);
  });

  test("is a no-op when already at the desired hash", async () => {
    const { deps, fetched, materialized } = makeDeps({
      currentLockfileHash: async () => "HASH1",
    });
    const res = await reconcileToHash({
      lockfileHash: "HASH1",
      manifest: [a, b],
      deps,
    });
    expect(res.alreadyConverged).toBe(true);
    expect(fetched).toEqual([]);
    expect(materialized).toEqual([]);
  });

  test("cold cache pulls the full blob set", async () => {
    const { deps, fetched } = makeDeps();
    await reconcileToHash({ lockfileHash: "H", manifest: [a, b], deps });
    expect(fetched.sort()).toEqual(["sha-a", "sha-b"]);
  });
});

describe("seedBlob blob-integrity verification (M1)", () => {
  let work: string;
  let blob: Uint8Array;

  beforeEach(async () => {
    work = await mkdtemp(path.join(tmpdir(), "cs-seed-"));
    // Build a real gzip-tar blob of a fake cache entry.
    const src = path.join(work, "src");
    const entryDir = path.join(src, "pkg@1.0.0");
    await mkdir(entryDir, { recursive: true });
    await writeFile(path.join(entryDir, "index.js"), "module.exports = 1;\n");
    blob = await packDir({ parentDir: src, entryName: "pkg@1.0.0" });
  });
  afterEach(async () => {
    await rm(work, { recursive: true, force: true });
  });

  const entryWith = (over: Partial<ManifestEntry> = {}): ManifestEntry => ({
    name: "pkg",
    version: "1.0.0",
    integrity: "sha512-npm-tarball-hash",
    ...over,
  });

  test("seeds a blob whose recorded blobSha256 matches", async () => {
    const storeRoot = path.join(work, "store");
    const deps = createReconcileFsDeps({
      storeRoot,
      fetchBlob: async () => blob,
    });
    await deps.seedBlob({
      entry: entryWith({ blobSha256: blobSha256(blob) }),
      bytes: blob,
    });
    // Extracted into the cache.
    const cacheEntries = await readdir(storePaths(storeRoot).cache);
    expect(cacheEntries).toContain("pkg@1.0.0");
  });

  test("rejects a tampered blob and does NOT unpack it", async () => {
    const storeRoot = path.join(work, "store2");
    const deps = createReconcileFsDeps({
      storeRoot,
      fetchBlob: async () => blob,
    });
    const tampered = new Uint8Array(blob);
    tampered[tampered.length - 1] ^= 0xff; // flip a byte

    await expect(
      deps.seedBlob({
        // Recorded hash is of the ORIGINAL blob; tampered bytes won't match.
        entry: entryWith({ blobSha256: blobSha256(blob) }),
        bytes: tampered,
      }),
    ).rejects.toThrow(/integrity check failed/i);

    // Nothing was extracted (cache dir absent or empty).
    const cacheDir = storePaths(storeRoot).cache;
    const entries = await readdir(cacheDir).catch(() => []);
    expect(entries).not.toContain("pkg@1.0.0");
  });

  test("backward-safe: an entry without blobSha256 still seeds", async () => {
    const storeRoot = path.join(work, "store3");
    const deps = createReconcileFsDeps({
      storeRoot,
      fetchBlob: async () => blob,
    });
    await deps.seedBlob({ entry: entryWith(), bytes: blob });
    const cacheEntries = await readdir(storePaths(storeRoot).cache);
    expect(cacheEntries).toContain("pkg@1.0.0");
  });
});
