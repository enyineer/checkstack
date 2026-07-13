import { describe, it, expect } from "bun:test";
import { IngestBuffer } from "./ingest-buffer";

/** A test item whose byte estimate is `body.length + 64` (mirrors a log line). */
interface Item {
  body: string;
}
const estimateBytes = (item: Item): number => item.body.length + 64;

function items(n: number): Item[] {
  return Array.from({ length: n }, (_, i) => ({ body: `l${i}` }));
}

/** Items whose body alone is `bodyLen` chars (drives the byte estimate). */
function fatItems(n: number, bodyLen: number): Item[] {
  return Array.from({ length: n }, () => ({ body: "x".repeat(bodyLen) }));
}

describe("IngestBuffer", () => {
  it("accepts up to the global cap and reports overflow", () => {
    const buffer = new IngestBuffer<Item>({ estimateBytes, globalCap: 5 });
    const first = buffer.push({ key: "s1", items: items(3) });
    expect(first).toEqual({ accepted: 3, rejected: 0 });
    const second = buffer.push({ key: "s1", items: items(4) });
    expect(second.accepted).toBe(2);
    expect(second.rejected).toBe(2);
    expect(buffer.size).toBe(5);
  });

  it("lets a lone key fill the whole buffer", () => {
    const buffer = new IngestBuffer<Item>({ estimateBytes, globalCap: 10 });
    const res = buffer.push({ key: "solo", items: items(10) });
    expect(res.accepted).toBe(10);
  });

  it("enforces a per-key fair share under contention", () => {
    const buffer = new IngestBuffer<Item>({ estimateBytes, globalCap: 10 });
    // Two keys active -> fair share floor(10/2)=5 each for the second push.
    buffer.push({ key: "s1", items: items(1) });
    const res = buffer.push({ key: "s2", items: items(10) });
    expect(res.accepted).toBe(5);
    expect(res.rejected).toBe(5);
  });

  it("drains grouped by key and resets size + bytes", () => {
    const buffer = new IngestBuffer<Item>({ estimateBytes, globalCap: 100 });
    buffer.push({ key: "s1", items: items(2) });
    buffer.push({ key: "s2", items: items(3) });
    expect(buffer.byteSize).toBeGreaterThan(0);
    const drained = buffer.drain();
    expect(drained.get("s1")).toHaveLength(2);
    expect(drained.get("s2")).toHaveLength(3);
    expect(buffer.size).toBe(0);
    expect(buffer.byteSize).toBe(0);
    expect(buffer.drain().size).toBe(0);
  });

  it("trips the byte budget before the item cap for fat items", () => {
    // Item cap 1000 (won't be reached); byte budget 1000. Each fat item is
    // 300 body + 64 overhead = 364 bytes, so only two fit.
    const buffer = new IngestBuffer<Item>({ estimateBytes, globalCap: 1000, byteCap: 1000 });
    const res = buffer.push({ key: "s1", items: fatItems(5, 300) });
    expect(res.accepted).toBe(2);
    expect(res.rejected).toBe(3);
    expect(buffer.size).toBe(2);
    expect(buffer.byteSize).toBe(728);
  });

  it("always admits at least one item even if it alone exceeds the byte budget", () => {
    // A single 300+64=364 byte item into a 100-byte budget: admitted so one fat
    // item can never wedge the buffer, but the next item is refused.
    const buffer = new IngestBuffer<Item>({ estimateBytes, globalCap: 1000, byteCap: 100 });
    const res = buffer.push({ key: "s1", items: fatItems(3, 300) });
    expect(res.accepted).toBe(1);
    expect(res.rejected).toBe(2);
  });

  it("hot-key-first can fill the cap and starve a later key until drain", () => {
    // Documented bounded-starvation behavior: fairness is per-push, not a
    // reservation. A key pushing first while alone fills the global cap; a later
    // key gets 0 until the next drain clears the buffer.
    const buffer = new IngestBuffer<Item>({ estimateBytes, globalCap: 10 });
    const hot = buffer.push({ key: "hot", items: items(10) });
    expect(hot.accepted).toBe(10);
    const late = buffer.push({ key: "late", items: items(5) });
    expect(late.accepted).toBe(0);
    expect(late.rejected).toBe(5);
    // After the flush drains, every key competes fresh.
    buffer.drain();
    const afterDrain = buffer.push({ key: "late", items: items(5) });
    expect(afterDrain.accepted).toBe(5);
  });

  it("reports per-key size", () => {
    const buffer = new IngestBuffer<Item>({ estimateBytes, globalCap: 100 });
    buffer.push({ key: "s1", items: items(4) });
    expect(buffer.keySize("s1")).toBe(4);
    expect(buffer.keySize("absent")).toBe(0);
  });

  it("default (reject-new) push shape is unchanged - no `dropped` field", () => {
    // Regression guard: the backend ingest endpoints depend on the exact
    // reject-new return shape { accepted, rejected } with NO dropped key.
    const buffer = new IngestBuffer<Item>({ estimateBytes, globalCap: 3 });
    const res = buffer.push({ key: "s1", items: items(5) });
    expect(res).toEqual({ accepted: 3, rejected: 2 });
    expect("dropped" in res).toBe(false);
    expect(buffer.size).toBe(3);
  });
});

describe("IngestBuffer dropOldest mode", () => {
  it("evicts oldest items to admit new ones under the item cap", () => {
    const buffer = new IngestBuffer<Item>({
      estimateBytes,
      globalCap: 3,
      dropOldest: true,
    });
    // Fill to cap, then push 2 more -> the 2 oldest are evicted, newest kept.
    const first = buffer.push({ key: "k", items: items(3) });
    expect(first).toEqual({ accepted: 3, rejected: 0, dropped: 0 });
    const second = buffer.push({
      key: "k",
      items: [{ body: "new1" }, { body: "new2" }],
    });
    expect(second.accepted).toBe(2);
    expect(second.rejected).toBe(0);
    expect(second.dropped).toBe(2);
    expect(buffer.size).toBe(3);
    // The three survivors are the two newest plus the last of the original run.
    const drained = buffer.drain().get("k") ?? [];
    expect(drained.map((i) => i.body)).toEqual(["l2", "new1", "new2"]);
  });

  it("evicts oldest to respect the byte cap, always keeping at least one", () => {
    // byteCap 1000; each fat item is 364 bytes -> at most 2 fit.
    const buffer = new IngestBuffer<Item>({
      estimateBytes,
      globalCap: 1000,
      byteCap: 1000,
      dropOldest: true,
    });
    buffer.push({ key: "k", items: fatItems(2, 300) });
    expect(buffer.size).toBe(2);
    const res = buffer.push({ key: "k", items: fatItems(2, 300) });
    // Two new admitted, two old evicted to stay under the byte cap.
    expect(res.accepted).toBe(2);
    expect(res.dropped).toBe(2);
    expect(buffer.size).toBe(2);
    expect(buffer.byteSize).toBe(728);
  });

  it("a burst larger than the cap keeps only the newest items", () => {
    const buffer = new IngestBuffer<Item>({
      estimateBytes,
      globalCap: 3,
      dropOldest: true,
    });
    const res = buffer.push({ key: "k", items: items(10) });
    expect(res.accepted).toBe(10);
    expect(res.dropped).toBe(7);
    expect(buffer.size).toBe(3);
    const drained = buffer.drain().get("k") ?? [];
    expect(drained.map((i) => i.body)).toEqual(["l7", "l8", "l9"]);
  });

  it("attributes evictions to the key each dropped item belonged to", () => {
    const buffer = new IngestBuffer<Item>({
      estimateBytes,
      globalCap: 4,
      dropOldest: true,
    });
    // Fill the cap across two keys: a (2 items, oldest), b (2 items).
    buffer.push({ key: "a", items: [{ body: "a0" }, { body: "a1" }] });
    buffer.push({ key: "b", items: [{ body: "b0" }, { body: "b1" }] });
    // Pushing 3 into key c evicts the 3 oldest across ALL keys in FIFO order:
    // both of a's items, then b's oldest -> a:2, b:1.
    const res = buffer.push({
      key: "c",
      items: [{ body: "c0" }, { body: "c1" }, { body: "c2" }],
    });
    expect(res.dropped).toBe(3);
    expect(res.droppedByKey).toEqual({ a: 2, b: 1 });
    // The per-key breakdown always sums back to the aggregate.
    const byKey: Record<string, number> = res.droppedByKey ?? {};
    const total = Object.values(byKey).reduce<number>((s, n) => s + n, 0);
    expect(total).toBe(3);
    expect(buffer.keySize("a")).toBe(0);
    expect(buffer.keySize("b")).toBe(1);
  });

  it("omits droppedByKey when nothing was evicted", () => {
    const buffer = new IngestBuffer<Item>({
      estimateBytes,
      globalCap: 5,
      dropOldest: true,
    });
    const res = buffer.push({ key: "k", items: items(3) });
    expect(res.dropped).toBe(0);
    expect("droppedByKey" in res).toBe(false);
  });
});

describe("IngestBuffer drainChunk", () => {
  it("carves a bounded chunk in FIFO order and leaves the rest", () => {
    const buffer = new IngestBuffer<Item>({ estimateBytes, globalCap: 100 });
    buffer.push({ key: "k", items: items(5) });
    const chunk = buffer.drainChunk({ maxItems: 2, maxBytes: 1_000_000 });
    expect(chunk.map((i) => i.body)).toEqual(["l0", "l1"]);
    expect(buffer.size).toBe(3);
    const rest = buffer.drainChunk({ maxItems: 100, maxBytes: 1_000_000 });
    expect(rest.map((i) => i.body)).toEqual(["l2", "l3", "l4"]);
    expect(buffer.size).toBe(0);
  });

  it("bounds a chunk by bytes but always returns at least one item", () => {
    const buffer = new IngestBuffer<Item>({ estimateBytes, globalCap: 100 });
    buffer.push({ key: "k", items: fatItems(4, 300) }); // 364 bytes each
    // maxBytes below a single item -> exactly one item returned.
    const chunk = buffer.drainChunk({ maxItems: 100, maxBytes: 100 });
    expect(chunk).toHaveLength(1);
    expect(buffer.size).toBe(3);
    // maxBytes fits two items (728) but not three (1092).
    const chunk2 = buffer.drainChunk({ maxItems: 100, maxBytes: 800 });
    expect(chunk2).toHaveLength(2);
    expect(buffer.size).toBe(1);
  });

  it("returns an empty chunk when the buffer is empty", () => {
    const buffer = new IngestBuffer<Item>({ estimateBytes });
    expect(buffer.drainChunk({ maxItems: 10, maxBytes: 1000 })).toEqual([]);
  });
});
