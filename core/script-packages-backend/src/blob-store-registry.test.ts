import { describe, expect, test } from "bun:test";
import type { BlobStore } from "./blob-store";
import { createBlobStoreRegistry } from "./blob-store-registry";

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

describe("BlobStoreRegistry", () => {
  test("registers and resolves stores by id", () => {
    const reg = createBlobStoreRegistry();
    reg.register(memStore("postgres"));
    reg.register(memStore("s3"));
    expect(reg.ids().sort()).toEqual(["postgres", "s3"]);
    expect(reg.has("s3")).toBe(true);
    expect(reg.get("postgres").id).toBe("postgres");
  });

  test("throws a helpful error for an unregistered backend", () => {
    const reg = createBlobStoreRegistry();
    reg.register(memStore("postgres"));
    expect(() => reg.get("s3")).toThrow(/not registered.*postgres/i);
  });

  test("reads from the active backend when present", async () => {
    const reg = createBlobStoreRegistry();
    reg.register(memStore("postgres", { "sha-1": "from-pg" }));
    reg.register(memStore("s3", { "sha-1": "from-s3" }));
    const res = await reg.readWithFallback({
      integrity: "sha-1",
      activeBackendId: "s3",
    });
    expect(res?.servedBy).toBe("s3");
    expect(new TextDecoder().decode(res?.bytes)).toBe("from-s3");
  });

  test("falls back to another backend when the active one lacks the blob", async () => {
    const reg = createBlobStoreRegistry();
    reg.register(memStore("postgres", { "sha-2": "only-in-pg" }));
    reg.register(memStore("s3"));
    const res = await reg.readWithFallback({
      integrity: "sha-2",
      activeBackendId: "s3",
    });
    expect(res?.servedBy).toBe("postgres");
    expect(new TextDecoder().decode(res?.bytes)).toBe("only-in-pg");
  });

  test("returns undefined when no backend has the blob", async () => {
    const reg = createBlobStoreRegistry();
    reg.register(memStore("postgres"));
    const res = await reg.readWithFallback({
      integrity: "missing",
      activeBackendId: "postgres",
    });
    expect(res).toBeUndefined();
  });
});
