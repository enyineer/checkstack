import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readdir, readlink, rm } from "node:fs/promises";
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

/**
 * N-host (multi-pod) convergence: two hosts over SEPARATE store roots
 * sharing ONE in-memory blob map (models two pods backed by one blob
 * store). Both reconcile to the same lockfileHash and must converge to the
 * same materialized tree; a second pass on each is idempotent.
 *
 * No network: the materialize uses an EMPTY manifest, so `bun install
 * --offline` builds an empty tree without touching a registry. The shared
 * blob map is still exercised by the delta-pull scenario below (a blob
 * seeded into the shared store is pulled identically by both hosts).
 */
describe("N-host reconcile convergence (shared blob store, two pods)", () => {
  let work: string;

  beforeEach(async () => {
    work = await mkdtemp(path.join(tmpdir(), "cs-nhost-"));
  });
  afterEach(async () => {
    await rm(work, { recursive: true, force: true });
  });

  /** Build a host's deps over its own store root, reading from a shared map. */
  function hostDeps(storeRoot: string, sharedBlobs: Map<string, Uint8Array>) {
    return createReconcileFsDeps({
      storeRoot,
      fetchBlob: async ({ integrity }) => {
        const bytes = sharedBlobs.get(integrity);
        if (!bytes) throw new Error(`blob ${integrity} not in shared store`);
        return bytes;
      },
    });
  }

  test("two hosts converge to the same tree at one hash; second pass is idempotent", async () => {
    // One shared blob store; two pods with independent local store roots.
    const sharedBlobs = new Map<string, Uint8Array>();
    const rootA = path.join(work, "podA");
    const rootB = path.join(work, "podB");
    const depsA = hostDeps(rootA, sharedBlobs);
    const depsB = hostDeps(rootB, sharedBlobs);

    const lockfileHash = "convergehash";
    const manifest: ManifestEntry[] = []; // empty → offline materialize, no net

    // First pass on each pod: both converge (not already-converged).
    const a1 = await reconcileToHash({ lockfileHash, manifest, deps: depsA });
    const b1 = await reconcileToHash({ lockfileHash, manifest, deps: depsB });
    expect(a1.alreadyConverged).toBe(false);
    expect(b1.alreadyConverged).toBe(false);

    // Both `current` symlinks point at the SAME tree (trees/<hash>).
    const targetA = await readlink(storePaths(rootA).current);
    const targetB = await readlink(storePaths(rootB).current);
    expect(path.basename(targetA)).toBe(lockfileHash);
    expect(path.basename(targetB)).toBe(lockfileHash);
    expect(path.basename(targetA)).toBe(path.basename(targetB));

    // Each pod materialized the tree (node_modules present under trees/<hash>).
    for (const root of [rootA, rootB]) {
      const tree = path.join(storePaths(root).trees, lockfileHash);
      const entries = await readdir(tree);
      expect(entries).toContain("node_modules");
      expect(entries).toContain("package.json");
    }

    // Second pass on each pod is a no-op (idempotent convergence).
    const a2 = await reconcileToHash({ lockfileHash, manifest, deps: depsA });
    const b2 = await reconcileToHash({ lockfileHash, manifest, deps: depsB });
    expect(a2.alreadyConverged).toBe(true);
    expect(b2.alreadyConverged).toBe(true);
    expect(a2.pulledIntegrities).toEqual([]);
    expect(b2.pulledIntegrities).toEqual([]);
  }, 60_000);

  test("both pods pull the SAME blob from the one shared store (delta sync)", async () => {
    // Seed one real packed blob into the shared store (no network).
    const src = path.join(work, "src");
    const entryDir = path.join(src, "pkg@1.0.0");
    await mkdir(entryDir, { recursive: true });
    await writeFile(path.join(entryDir, "index.js"), "module.exports = 1;\n");
    const bytes = await packDir({ parentDir: src, entryName: "pkg@1.0.0" });

    const entry: ManifestEntry = {
      name: "pkg",
      version: "1.0.0",
      integrity: "sha512-shared-blob",
      blobSha256: blobSha256(bytes),
    };
    const sharedBlobs = new Map<string, Uint8Array>([[entry.integrity, bytes]]);

    const rootA = path.join(work, "podA");
    const rootB = path.join(work, "podB");

    // Each pod, cold cache, seeds the missing blob — pulling the SAME bytes
    // from the one shared store into its own local cache.
    const fetchedA: string[] = [];
    const fetchedB: string[] = [];
    const depsA = createReconcileFsDeps({
      storeRoot: rootA,
      fetchBlob: async ({ integrity }) => {
        fetchedA.push(integrity);
        const b = sharedBlobs.get(integrity);
        if (!b) throw new Error("missing");
        return b;
      },
    });
    const depsB = createReconcileFsDeps({
      storeRoot: rootB,
      fetchBlob: async ({ integrity }) => {
        fetchedB.push(integrity);
        const b = sharedBlobs.get(integrity);
        if (!b) throw new Error("missing");
        return b;
      },
    });

    // Drive only the seeding side (delta diff + seedBlob) — both pods start
    // cold, so both pull the one shared blob.
    expect(await depsA.localCacheIntegrities()).toEqual([]);
    expect(await depsB.localCacheIntegrities()).toEqual([]);
    await depsA.seedBlob({ entry, bytes: await depsA.fetchBlob({ integrity: entry.integrity }) });
    await depsB.seedBlob({ entry, bytes: await depsB.fetchBlob({ integrity: entry.integrity }) });

    expect(fetchedA).toEqual([entry.integrity]);
    expect(fetchedB).toEqual([entry.integrity]);

    // Both pods now have the blob locally, materialized into the same cache
    // entry layout from the identical shared bytes.
    for (const root of [rootA, rootB]) {
      const cacheEntries = await readdir(storePaths(root).cache);
      expect(cacheEntries).toContain("pkg@1.0.0");
    }
    expect(await depsA.localCacheIntegrities()).toEqual([entry.integrity]);
    expect(await depsB.localCacheIntegrities()).toEqual([entry.integrity]);
  });
});
