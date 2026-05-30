import { describe, expect, test } from "bun:test";
import type { ManifestEntry } from "@checkstack/script-packages-common";
import {
  performInstall,
  type BlobIndex,
  type BlobPublisher,
  type Resolver,
  type ResolvedPackage,
} from "./install-service";
import { computeLockfileHash } from "./lockfile";

function resolved(entry: ManifestEntry, blobLen: number): ResolvedPackage {
  return { entry, blob: new Uint8Array(blobLen) };
}

function fakeResolver(packages: ResolvedPackage[]): Resolver {
  return { resolve: async () => packages };
}

function fakeBlobStore(seed: string[] = []): {
  store: BlobPublisher;
  puts: string[];
} {
  const present = new Set(seed);
  const puts: string[] = [];
  return {
    puts,
    store: {
      id: "postgres",
      has: async ({ integrity }) => present.has(integrity),
      put: async ({ integrity }) => {
        present.add(integrity);
        puts.push(integrity);
      },
    },
  };
}

function fakeIndex(): { index: BlobIndex; records: string[] } {
  const records: string[] = [];
  return {
    records,
    index: {
      record: async ({ integrity }) => {
        records.push(integrity);
      },
    },
  };
}

const a: ManifestEntry = { name: "a", version: "1.0.0", integrity: "sha-a" };
const b: ManifestEntry = { name: "b", version: "2.0.0", integrity: "sha-b" };

describe("performInstall", () => {
  test("publishes all blobs on a fresh store and records the index", async () => {
    const { store, puts } = fakeBlobStore();
    const { index, records } = fakeIndex();
    const res = await performInstall({
      packages: [],
      ignoreScripts: true,
      resolver: fakeResolver([resolved(a, 100), resolved(b, 200)]),
      blobStore: store,
      blobIndex: index,
    });
    expect(puts.sort()).toEqual(["sha-a", "sha-b"]);
    expect(records.sort()).toEqual(["sha-a", "sha-b"]);
    expect(res.totalSizeBytes).toBe(300);
    expect(res.manifest).toHaveLength(2);
    expect(res.lockfileHash).toBe(computeLockfileHash([a, b]));
    expect(res.publishedIntegrities.sort()).toEqual(["sha-a", "sha-b"]);
  });

  test("skips publishing blobs already in the store (delta), still in the manifest", async () => {
    const { store, puts } = fakeBlobStore(["sha-a"]);
    const { index, records } = fakeIndex();
    const res = await performInstall({
      packages: [],
      ignoreScripts: true,
      resolver: fakeResolver([resolved(a, 100), resolved(b, 200)]),
      blobStore: store,
      blobIndex: index,
    });
    expect(puts).toEqual(["sha-b"]); // only the new one
    expect(records).toEqual(["sha-b"]);
    expect(res.manifest).toHaveLength(2); // both still in the manifest
    expect(res.totalSizeBytes).toBe(300);
    expect(res.publishedIntegrities).toEqual(["sha-b"]);
  });

  test("empty allowlist yields an empty, deterministic manifest", async () => {
    const { store } = fakeBlobStore();
    const { index } = fakeIndex();
    const res = await performInstall({
      packages: [],
      ignoreScripts: true,
      resolver: fakeResolver([]),
      blobStore: store,
      blobIndex: index,
    });
    expect(res.manifest).toEqual([]);
    expect(res.totalSizeBytes).toBe(0);
    expect(res.lockfileHash).toBe(computeLockfileHash([]));
  });
});
