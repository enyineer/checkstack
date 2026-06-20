import { describe, expect, it } from "bun:test";
import { selectShard } from "./shard";

describe("selectShard", () => {
  const items = ["a", "b", "c", "d", "e", "f", "g"];

  it("partitions the list into disjoint shards that union to the whole", () => {
    const total = 3;
    const s1 = selectShard({ items, shardIndex: 1, shardTotal: total });
    const s2 = selectShard({ items, shardIndex: 2, shardTotal: total });
    const s3 = selectShard({ items, shardIndex: 3, shardTotal: total });

    // Round-robin assignment over 7 items / 3 shards.
    expect(s1).toEqual(["a", "d", "g"]);
    expect(s2).toEqual(["b", "e"]);
    expect(s3).toEqual(["c", "f"]);

    // No overlaps, and every item is covered exactly once.
    expect([...s1, ...s2, ...s3].toSorted()).toEqual([...items].toSorted());
  });

  it("keeps shard sizes balanced to within one item", () => {
    const total = 3;
    const sizes = [1, 2, 3].map(
      (i) => selectShard({ items, shardIndex: i, shardTotal: total }).length,
    );
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it("returns the whole list for a single shard", () => {
    expect(selectShard({ items, shardIndex: 1, shardTotal: 1 })).toEqual(items);
  });

  it("can yield an empty shard when there are more shards than items", () => {
    expect(
      selectShard({ items: ["only"], shardIndex: 2, shardTotal: 3 }),
    ).toEqual([]);
  });

  it("rejects a non-positive shard total", () => {
    expect(() =>
      selectShard({ items, shardIndex: 1, shardTotal: 0 }),
    ).toThrow(/positive integer/);
  });

  it("rejects a shard index outside [1, total]", () => {
    expect(() =>
      selectShard({ items, shardIndex: 0, shardTotal: 3 }),
    ).toThrow(/in \[1, 3\]/);
    expect(() =>
      selectShard({ items, shardIndex: 4, shardTotal: 3 }),
    ).toThrow(/in \[1, 3\]/);
  });

  it("rejects non-integer shard config", () => {
    expect(() =>
      selectShard({ items, shardIndex: 1.5, shardTotal: 3 }),
    ).toThrow();
    expect(() =>
      selectShard({ items, shardIndex: Number.NaN, shardTotal: 3 }),
    ).toThrow();
  });
});
