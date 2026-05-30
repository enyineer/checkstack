import { describe, expect, test } from "bun:test";
import type { ManifestEntry } from "@checkstack/script-packages-common";
import { createBlobGcTrigger, type BlobGcRunnerDeps } from "./blob-gc-runner";
import type { InstallerLock } from "./install-state-store";
import type { BlobStore } from "./blob-store";
import { createBlobStoreRegistry } from "./blob-store-registry";
import type { GcBlob } from "./blob-gc";

function entry(integrity: string): ManifestEntry {
  return { name: integrity, version: "1.0.0", integrity };
}

function fakeStore(id: string, deletes: string[]): BlobStore {
  return {
    id,
    put: async () => {},
    get: async () => undefined,
    has: async () => true,
    delete: async ({ integrity }) => void deletes.push(`${id}:${integrity}`),
    list: async () => [],
  };
}

function lockThatGrants(calls: string[]): InstallerLock {
  return {
    tryInstallerLock: async () => ({
      release: async () => void calls.push("released"),
    }),
  };
}

const OLD = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

function makeDeps(over: Partial<BlobGcRunnerDeps> = {}): {
  deps: BlobGcRunnerDeps;
  storeDeletes: string[];
  lockCalls: string[];
  pruned: number[];
  removed: string[];
} {
  const storeDeletes: string[] = [];
  const lockCalls: string[] = [];
  const pruned: number[] = [];
  const removed: string[] = [];
  const registry = createBlobStoreRegistry();
  registry.register(fakeStore("postgres", storeDeletes));
  registry.register(fakeStore("s3", storeDeletes));

  const deps: BlobGcRunnerDeps = {
    installerLock: lockThatGrants(lockCalls),
    blobStores: registry,
    loadCurrent: async () => ({ lockfileHash: "CUR", manifest: [entry("a")] }),
    recentHistory: async () => [[entry("a")]],
    pruneHistory: async (keep) => void pruned.push(keep),
    listBlobs: async (): Promise<GcBlob[]> => [
      { integrity: "a", backend: "postgres", sizeBytes: 10, createdAt: OLD },
      {
        integrity: "orphan",
        backend: "s3",
        sizeBytes: 99,
        createdAt: OLD,
      },
    ],
    removeBlobRow: async (i) => void removed.push(i),
    isBusy: async () => false,
    recordRun: async () => {},
    ...over,
  };
  return { deps, storeDeletes, lockCalls, pruned, removed };
}

describe("createBlobGcTrigger", () => {
  test("deletes orphan bytes via its recorded backend, drops the index row, releases the lock", async () => {
    const { deps, storeDeletes, lockCalls, removed } = makeDeps();
    const out = await createBlobGcTrigger(deps)();
    expect(out.ran).toBe(true);
    expect(out.deleted).toBe(1);
    expect(out.bytesReclaimed).toBe(99);
    // routed to s3 (the orphan's backend), referenced "a" untouched.
    expect(storeDeletes).toEqual(["s3:orphan"]);
    expect(removed).toEqual(["orphan"]);
    expect(lockCalls).toContain("released");
  });

  test("refuses + releases nothing when the installer lock is held", async () => {
    const { deps, storeDeletes } = makeDeps({
      installerLock: { tryInstallerLock: async () => null },
    });
    const out = await createBlobGcTrigger(deps)();
    expect(out.ran).toBe(false);
    expect(out.reason).toMatch(/installer lock/i);
    expect(storeDeletes).toHaveLength(0);
  });

  test("prunes lockfile history to the retained window and releases the lock even on failure", async () => {
    const { deps, pruned, lockCalls } = makeDeps({
      listBlobs: async () => {
        throw new Error("db down");
      },
      retainPrevious: 2,
    });
    const out = await createBlobGcTrigger(deps)();
    expect(out.ran).toBe(false);
    expect(out.reason).toBe("db down");
    // pruneHistory(keep = retainPrevious + 1) still ran; lock released.
    expect(pruned).toEqual([3]);
    expect(lockCalls).toContain("released");
  });

  test("unions the live install-state manifest into the retained set", async () => {
    // History is empty, but the current manifest references "a" → keep it.
    const { deps, storeDeletes } = makeDeps({
      recentHistory: async () => [],
      loadCurrent: async () => ({ lockfileHash: "CUR", manifest: [entry("a")] }),
    });
    const out = await createBlobGcTrigger(deps)();
    expect(storeDeletes).toEqual(["s3:orphan"]); // "a" retained via current
    expect(out.deleted).toBe(1);
  });
});
