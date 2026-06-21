import { describe, it, expect } from "bun:test";
import type { SafeDatabase } from "@checkstack/backend-api";
import { computeSha256Hex } from "./integrity";
import { verifyAndBackfillArtifactDigest } from "./reload-verification";

const bytes = new Uint8Array([10, 20, 30, 40]);
const digest = computeSha256Hex(bytes);

/**
 * Minimal fake DB capturing `update(...).set(...).where(...)` for the backfill
 * path. We only need to observe the `set` payload; the chain returns `this`.
 */
function makeFakeDb(): {
  db: SafeDatabase<Record<string, unknown>>;
  updates: Array<Record<string, unknown>>;
} {
  const updates: Array<Record<string, unknown>> = [];
  const chain = {
    update() {
      return this;
    },
    set(values: Record<string, unknown>) {
      updates.push(values);
      return this;
    },
    where() {
      return Promise.resolve();
    },
  };
  // The helper only uses `.update().set().where()`; the rest of SafeDatabase is
  // irrelevant here. Cast through `unknown` since we deliberately implement a
  // partial fake for a focused unit test.
  const db = chain as unknown as SafeDatabase<Record<string, unknown>>;
  return { db, updates };
}

describe("verifyAndBackfillArtifactDigest", () => {
  it("no-ops (no update) when the recorded digest matches", async () => {
    const { db, updates } = makeFakeDb();
    await verifyAndBackfillArtifactDigest({
      db,
      pluginName: "p",
      tarball: bytes,
      recordedDigest: digest,
    });
    expect(updates).toHaveLength(0);
  });

  it("backfills the digest when none was recorded", async () => {
    const { db, updates } = makeFakeDb();
    await verifyAndBackfillArtifactDigest({
      db,
      pluginName: "p",
      tarball: bytes,
      recordedDigest: null,
    });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual({ installedDigest: digest });
  });

  it("FAILS CLOSED (throws, no backfill) on a tamper mismatch", async () => {
    const { db, updates } = makeFakeDb();
    await expect(
      verifyAndBackfillArtifactDigest({
        db,
        pluginName: "evil",
        tarball: bytes,
        recordedDigest: computeSha256Hex(new Uint8Array([99])),
      }),
    ).rejects.toThrow(/Tamper detected/);
    expect(updates).toHaveLength(0);
  });
});
