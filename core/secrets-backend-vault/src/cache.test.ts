import { describe, it, expect } from "bun:test";
import { createValueCache } from "./cache";

describe("createValueCache", () => {
  it("returns a cached value before TTL expiry", () => {
    let t = 1000;
    const cache = createValueCache({ ttlMs: 500, now: () => t });
    cache.set("a", "value-a");
    t = 1400; // < 1000 + 500
    expect(cache.get("a")).toBe("value-a");
  });

  it("expires a value at/after TTL", () => {
    let t = 1000;
    const cache = createValueCache({ ttlMs: 500, now: () => t });
    cache.set("a", "value-a");
    t = 1500; // == expiry
    expect(cache.get("a")).toBeUndefined();
  });

  it("delete and clear drop entries", () => {
    const cache = createValueCache({ ttlMs: 10_000 });
    cache.set("a", "1");
    cache.set("b", "2");
    cache.delete("a");
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe("2");
    cache.clear();
    expect(cache.get("b")).toBeUndefined();
  });
});
