import { describe, expect, test } from "bun:test";
import type { ManifestEntry } from "@checkstack/script-packages-common";
import { runBlobGc, type BlobGcDeps, type GcBlob } from "./blob-gc";

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function entry(name: string, integrity: string): ManifestEntry {
  return { name, version: "1.0.0", integrity };
}

function blob(over: Partial<GcBlob> & { integrity: string }): GcBlob {
  return {
    backend: "postgres",
    sizeBytes: 100,
    createdAt: new Date(NOW - 2 * DAY), // past-grace by default
    ...over,
  };
}

function makeDeps(
  over: Partial<BlobGcDeps> = {},
): {
  deps: BlobGcDeps;
  deletes: { integrity: string; backend: string }[];
  recorded: { deleted: number; bytesReclaimed: number }[];
} {
  const deletes: { integrity: string; backend: string }[] = [];
  const recorded: { deleted: number; bytesReclaimed: number }[] = [];
  const deps: BlobGcDeps = {
    retainedManifests: async () => [[entry("a", "sha-a")]],
    listBlobs: async () => [blob({ integrity: "sha-a" })],
    deleteBlob: async (input) => void deletes.push(input),
    isBusy: async () => false,
    recordRun: async (r) => void recorded.push(r),
    now: () => NOW,
    ...over,
  };
  return { deps, deletes, recorded };
}

describe("runBlobGc", () => {
  test("never deletes a blob referenced by a retained manifest", async () => {
    const { deps, deletes } = makeDeps({
      retainedManifests: async () => [[entry("a", "sha-a")]],
      listBlobs: async () => [
        blob({ integrity: "sha-a" }),
        blob({ integrity: "sha-orphan" }),
      ],
    });
    const out = await runBlobGc({ deps });
    expect(out.ran).toBe(true);
    // Only the orphan is a candidate; the referenced blob is untouched.
    expect(deletes.map((d) => d.integrity)).toEqual(["sha-orphan"]);
    expect(out.candidates).toBe(1);
    expect(out.deleted).toBe(1);
  });

  test("retains blobs referenced by ANY retained manifest (current + previous)", async () => {
    const { deps, deletes } = makeDeps({
      // current references sha-a, previous references sha-b.
      retainedManifests: async () => [
        [entry("a", "sha-a")],
        [entry("b", "sha-b")],
      ],
      listBlobs: async () => [
        blob({ integrity: "sha-a" }),
        blob({ integrity: "sha-b" }),
        blob({ integrity: "sha-old" }),
      ],
    });
    const out = await runBlobGc({ deps });
    expect(deletes.map((d) => d.integrity)).toEqual(["sha-old"]);
    expect(out.deleted).toBe(1);
  });

  test("deletes unreferenced blobs past the grace window", async () => {
    const { deps, deletes } = makeDeps({
      retainedManifests: async () => [[entry("a", "sha-a")]],
      listBlobs: async () => [
        blob({ integrity: "sha-old", createdAt: new Date(NOW - 2 * DAY) }),
      ],
      graceMs: DAY,
    });
    const out = await runBlobGc({ deps });
    expect(deletes.map((d) => d.integrity)).toEqual(["sha-old"]);
    expect(out.deleted).toBe(1);
    expect(out.keptWithinGrace).toBe(0);
  });

  test("keeps unreferenced blobs still within the grace window", async () => {
    const { deps, deletes } = makeDeps({
      retainedManifests: async () => [[entry("a", "sha-a")]],
      listBlobs: async () => [
        blob({ integrity: "sha-fresh", createdAt: new Date(NOW - HOUR) }),
      ],
      graceMs: DAY,
    });
    const out = await runBlobGc({ deps });
    expect(deletes).toHaveLength(0);
    expect(out.candidates).toBe(1);
    expect(out.deleted).toBe(0);
    expect(out.keptWithinGrace).toBe(1);
  });

  test("refuses to run while an install / migration is in flight", async () => {
    const { deps, deletes } = makeDeps({
      isBusy: async () => true,
      listBlobs: async () => [blob({ integrity: "sha-old" })],
    });
    const out = await runBlobGc({ deps });
    expect(out.ran).toBe(false);
    expect(out.reason).toMatch(/install|migration/i);
    expect(deletes).toHaveLength(0);
  });

  test("routes each delete to the blob's recorded backend", async () => {
    const { deps, deletes } = makeDeps({
      retainedManifests: async () => [[]],
      listBlobs: async () => [
        blob({ integrity: "sha-pg", backend: "postgres" }),
        blob({ integrity: "sha-s3", backend: "s3" }),
      ],
    });
    await runBlobGc({ deps });
    expect(deletes).toEqual([
      { integrity: "sha-pg", backend: "postgres" },
      { integrity: "sha-s3", backend: "s3" },
    ]);
  });

  test("accounts for reclaimed bytes", async () => {
    const { deps, recorded } = makeDeps({
      retainedManifests: async () => [[]],
      listBlobs: async () => [
        blob({ integrity: "x", sizeBytes: 500 }),
        blob({ integrity: "y", sizeBytes: 250 }),
      ],
    });
    const out = await runBlobGc({ deps });
    expect(out.bytesReclaimed).toBe(750);
    expect(recorded).toEqual([{ deleted: 2, bytesReclaimed: 750 }]);
  });

  test("is idempotent: a re-run after deletion reclaims nothing", async () => {
    let store = [blob({ integrity: "x" }), blob({ integrity: "orphan" })];
    const deps: BlobGcDeps = {
      retainedManifests: async () => [[entry("x", "x")]],
      listBlobs: async () => store,
      deleteBlob: async ({ integrity }) => {
        store = store.filter((b) => b.integrity !== integrity);
      },
      isBusy: async () => false,
      now: () => NOW,
    };
    const first = await runBlobGc({ deps });
    expect(first.deleted).toBe(1);
    const second = await runBlobGc({ deps });
    expect(second.deleted).toBe(0);
    expect(second.candidates).toBe(0);
  });

  test("a failed single delete is logged and skipped, not fatal", async () => {
    const errors: string[] = [];
    const { deps } = makeDeps({
      retainedManifests: async () => [[]],
      listBlobs: async () => [
        blob({ integrity: "bad" }),
        blob({ integrity: "good" }),
      ],
      deleteBlob: async ({ integrity }) => {
        if (integrity === "bad") throw new Error("backend offline");
      },
      logger: { debug: () => {}, error: (m) => void errors.push(m) },
    });
    const out = await runBlobGc({ deps });
    // "good" still deleted; "bad" retained for next pass.
    expect(out.deleted).toBe(1);
    expect(errors.some((e) => /bad/.test(e))).toBe(true);
  });
});
