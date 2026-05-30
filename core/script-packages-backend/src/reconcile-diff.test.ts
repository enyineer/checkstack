import { describe, expect, test } from "bun:test";
import type { ManifestEntry } from "@checkstack/script-packages-common";
import { computeMissingBlobs } from "./reconcile-diff";

const a: ManifestEntry = { name: "a", version: "1.0.0", integrity: "sha-a" };
const b: ManifestEntry = { name: "b", version: "2.0.0", integrity: "sha-b" };
const c: ManifestEntry = { name: "c", version: "3.0.0", integrity: "sha-c" };

describe("computeMissingBlobs", () => {
  test("returns only integrities not present locally (delta)", () => {
    const missing = computeMissingBlobs({
      manifest: [a, b, c],
      localIntegrities: ["sha-a", "sha-c"],
    });
    expect(missing.map((e) => e.integrity)).toEqual(["sha-b"]);
  });

  test("returns the full manifest for an empty (cold) cache", () => {
    const missing = computeMissingBlobs({
      manifest: [a, b],
      localIntegrities: [],
    });
    expect(missing).toHaveLength(2);
  });

  test("returns nothing when already at the desired set (idempotent)", () => {
    const missing = computeMissingBlobs({
      manifest: [a, b],
      localIntegrities: ["sha-a", "sha-b"],
    });
    expect(missing).toEqual([]);
  });

  test("dedupes repeated integrities", () => {
    const missing = computeMissingBlobs({
      manifest: [a, { ...b, integrity: "sha-a" }],
      localIntegrities: [],
    });
    expect(missing).toHaveLength(1);
  });
});
