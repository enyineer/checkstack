import { describe, expect, test } from "bun:test";
import type { ManifestEntry } from "@checkstack/script-packages-common";
import { reconcileToHash, type ReconcileDeps } from "./reconciler";

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
