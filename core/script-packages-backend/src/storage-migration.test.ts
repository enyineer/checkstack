import { describe, expect, test } from "bun:test";
import type { BlobStore } from "./blob-store";
import {
  runStorageMigration,
  type StorageMigrationConfig,
  type StorageMigrationStores,
} from "./storage-migration";

function memStore(id: string, seed: Record<string, string> = {}): BlobStore {
  const map = new Map<string, Uint8Array>(
    Object.entries(seed).map(([k, v]) => [k, new TextEncoder().encode(v)]),
  );
  return {
    id,
    async put({ integrity, bytes }) {
      map.set(integrity, bytes);
    },
    async get({ integrity }) {
      return map.get(integrity);
    },
    async has({ integrity }) {
      return map.has(integrity);
    },
    async delete({ integrity }) {
      map.delete(integrity);
    },
    async list() {
      return [...map.keys()];
    },
  };
}

/** In-memory blob index + storage-config doubles. */
function harness(initial: { integrity: string; backend: string }[]) {
  const index = new Map(initial.map((b) => [b.integrity, b.backend]));
  const config = {
    status: "idle" as string,
    activeBackend: "postgres",
    target: null as string | null,
    migratedCount: 0,
    error: null as string | null,
  };
  const blobIndex: StorageMigrationStores = {
    listNotOnBackend: async (target) =>
      [...index.entries()]
        .filter(([, backend]) => backend !== target)
        .map(([integrity, backend]) => ({ integrity, backend })),
    setBackend: async (integrity, backend) => {
      index.set(integrity, backend);
    },
  };
  const storage: StorageMigrationConfig = {
    beginMigration: async (target) => {
      config.status = "migrating";
      config.target = target;
      config.migratedCount = 0;
      config.error = null;
    },
    setMigratedCount: async (n) => {
      config.migratedCount = n;
    },
    completeMigration: async (target) => {
      config.status = "completed";
      config.activeBackend = target;
    },
    failMigration: async (message) => {
      config.status = "error";
      config.error = message;
    },
  };
  return { index, config, blobIndex, storage };
}

describe("runStorageMigration", () => {
  test("copies + verifies every blob, then atomically flips active backend", async () => {
    const pg = memStore("postgres", { "sha-a": "AAA", "sha-b": "BBB" });
    const s3 = memStore("s3");
    const { index, config, blobIndex, storage } = harness([
      { integrity: "sha-a", backend: "postgres" },
      { integrity: "sha-b", backend: "postgres" },
    ]);

    const res = await runStorageMigration({
      blobIndex,
      storage,
      getStore: (id) => (id === "postgres" ? pg : s3),
      activeBackend: "postgres",
      target: "s3",
    });

    expect(res.completed).toBe(true);
    expect(res.migrated).toBe(2);
    // Bytes copied to target + index flipped.
    expect(new TextDecoder().decode(await s3.get({ integrity: "sha-a" }))).toBe("AAA");
    expect(index.get("sha-a")).toBe("s3");
    expect(index.get("sha-b")).toBe("s3");
    // Active backend flipped only at completion.
    expect(config.activeBackend).toBe("s3");
    expect(config.status).toBe("completed");
    expect(config.migratedCount).toBe(2);
  });

  test("resumes from a partial state (blobs already on target are skipped)", async () => {
    // sha-a already migrated; only sha-b remains.
    const pg = memStore("postgres", { "sha-b": "BBB" });
    const s3 = memStore("s3", { "sha-a": "AAA" });
    const { index, config, blobIndex, storage } = harness([
      { integrity: "sha-a", backend: "s3" }, // already flipped
      { integrity: "sha-b", backend: "postgres" },
    ]);

    const res = await runStorageMigration({
      blobIndex,
      storage,
      getStore: (id) => (id === "postgres" ? pg : s3),
      activeBackend: "postgres",
      target: "s3",
    });

    expect(res.migrated).toBe(1); // only sha-b
    expect(index.get("sha-b")).toBe("s3");
    expect(config.activeBackend).toBe("s3");
  });

  test("aborts cleanly on an integrity mismatch (active backend unchanged)", async () => {
    const pg = memStore("postgres", { "sha-a": "AAA" });
    // Target silently corrupts on write (put stores different bytes).
    const corrupt: BlobStore = {
      id: "s3",
      async put() {
        /* drop the write */
      },
      async get() {
        return new TextEncoder().encode("CORRUPT");
      },
      async has() {
        return false;
      },
      async delete() {},
      async list() {
        return [];
      },
    };
    const { index, config, blobIndex, storage } = harness([
      { integrity: "sha-a", backend: "postgres" },
    ]);

    const res = await runStorageMigration({
      blobIndex,
      storage,
      getStore: (id) => (id === "postgres" ? pg : corrupt),
      activeBackend: "postgres",
      target: "s3",
    });

    expect(res.completed).toBe(false);
    expect(res.error).toMatch(/integrity verification failed/i);
    expect(config.status).toBe("error");
    expect(config.activeBackend).toBe("postgres"); // NOT flipped
    expect(index.get("sha-a")).toBe("postgres"); // NOT flipped
  });

  test("GCs the source after a verified copy when gcSource is set", async () => {
    const pg = memStore("postgres", { "sha-a": "AAA" });
    const s3 = memStore("s3");
    const { blobIndex, storage } = harness([
      { integrity: "sha-a", backend: "postgres" },
    ]);

    await runStorageMigration({
      blobIndex,
      storage,
      getStore: (id) => (id === "postgres" ? pg : s3),
      activeBackend: "postgres",
      target: "s3",
      gcSource: true,
    });

    expect(await pg.has({ integrity: "sha-a" })).toBe(false); // GC'd
    expect(await s3.has({ integrity: "sha-a" })).toBe(true);
  });

  test("no-op when target equals the active backend", async () => {
    const { config, blobIndex, storage } = harness([]);
    const res = await runStorageMigration({
      blobIndex,
      storage,
      getStore: () => memStore("postgres"),
      activeBackend: "postgres",
      target: "postgres",
    });
    expect(res.completed).toBe(true);
    expect(res.migrated).toBe(0);
    expect(config.status).toBe("idle"); // beginMigration not called
  });

  test("aborts when a source blob is missing", async () => {
    const pg = memStore("postgres"); // empty — sha-a missing
    const s3 = memStore("s3");
    const { config, blobIndex, storage } = harness([
      { integrity: "sha-a", backend: "postgres" },
    ]);
    const res = await runStorageMigration({
      blobIndex,
      storage,
      getStore: (id) => (id === "postgres" ? pg : s3),
      activeBackend: "postgres",
      target: "s3",
    });
    expect(res.completed).toBe(false);
    expect(res.error).toMatch(/missing from its source backend/i);
    expect(config.activeBackend).toBe("postgres");
  });
});
