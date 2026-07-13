/**
 * Bounded, per-pod WRITE buffer for normalized ingest items, generic over the
 * item type (log lines, metric datapoints, ...).
 *
 * STATE & SCALE: this is a short-lived pod-local write buffer, NEVER a queryable
 * source of truth. Items live here only between arriving on an endpoint and the
 * next flush; the durable record is the flush's Postgres writes. A value in this
 * buffer is intentionally invisible to other pods - each pod buffers and flushes
 * its own intake independently (see state-and-scale.md).
 *
 * Capacity is bounded by BOTH an item count AND an approximate byte budget; a
 * push is refused when EITHER trips. The byte budget is the real OOM guard: a
 * high item cap at a large per-item size is a lot of heap if only the count were
 * bounded, and worse as per-item size rises - one slow flush can let intake
 * reach the item cap. When full, `push` reports the overflow so the endpoint can
 * answer 429.
 *
 * FAIRNESS (bounded, not eliminated): each push is additionally limited to a
 * per-key fair share `floor(globalCap / activeKeys)`, so a single push from a
 * newly-active key cannot monopolize space while other keys are already
 * buffered. This does NOT reserve space for keys that have not pushed yet: a hot
 * key pushing FIRST can fill the global cap before a quieter key's first push in
 * the same flush window, and that key then gets 0 until the next `drain`.
 * Starvation is therefore bounded by the flush interval, after which `drain`
 * clears the buffer and every key competes fresh - it is not prevented outright.
 *
 * Pure module: no IO. The byte estimate for an item is injected so the buffer
 * stays agnostic to the item shape.
 */

export const DEFAULT_BUFFER_GLOBAL_CAP = 20_000;
/** Global approximate-byte budget across all buffered items (OOM guard). */
export const DEFAULT_BUFFER_BYTE_CAP = 64 * 1024 * 1024;

export interface BufferPushResult {
  accepted: number;
  /** Items refused because the buffer (item cap, byte cap, or fair share) was full. */
  rejected: number;
  /**
   * Items EVICTED to make room for this push. Only ever non-zero in `dropOldest`
   * mode; omitted entirely in the default reject-new mode so the two modes stay
   * distinguishable and the default return shape is unchanged.
   */
  dropped?: number;
  /**
   * Evictions broken down by the KEY each dropped item belonged to (only present
   * in `dropOldest` mode, and only when something was dropped). Lets a caller
   * attribute the loss to the specific key (e.g. per-stream) instead of a single
   * aggregate. The sum of its values always equals `dropped`.
   */
  droppedByKey?: Record<string, number>;
}

export class IngestBuffer<TItem> {
  private readonly keys = new Map<string, TItem[]>();
  /**
   * Insertion order across ALL keys, one entry (the key) per buffered item.
   * Enables true oldest-first eviction (`dropOldest`) and FIFO chunked draining
   * (`drainChunk`) without changing the per-key bucket storage. Kept in sync on
   * every accept / evict / drain; its length always equals `total`.
   */
  private readonly order: string[] = [];
  private total = 0;
  private totalBytes = 0;
  private readonly globalCap: number;
  private readonly byteCap: number;
  private readonly dropOldest: boolean;
  private readonly estimateBytes: (item: TItem) => number;

  constructor({
    estimateBytes,
    globalCap = DEFAULT_BUFFER_GLOBAL_CAP,
    byteCap = DEFAULT_BUFFER_BYTE_CAP,
    dropOldest = false,
  }: {
    /** Approximate the heap bytes an item occupies (drives the byte budget). */
    estimateBytes: (item: TItem) => number;
    globalCap?: number;
    byteCap?: number;
    /**
     * When true, a push that would breach the item OR byte cap EVICTS the oldest
     * buffered items to make room instead of rejecting the new items, and reports
     * how many were dropped. Used by the satellite agent's telemetry buffers,
     * where the newest telemetry is the most valuable and loss is acceptable +
     * counted. Default false preserves the reject-new behavior the backend
     * ingest endpoints depend on (they answer 429 on overflow).
     */
    dropOldest?: boolean;
  }) {
    this.estimateBytes = estimateBytes;
    this.globalCap = globalCap;
    this.byteCap = byteCap;
    this.dropOldest = dropOldest;
  }

  /** Current buffered item count across all keys. */
  get size(): number {
    return this.total;
  }

  /** Current approximate buffered byte count across all keys. */
  get byteSize(): number {
    return this.totalBytes;
  }

  /** Buffered item count for one key. */
  keySize(key: string): number {
    return this.keys.get(key)?.length ?? 0;
  }

  /**
   * Push items for a key. An item is accepted only while ALL of: the global item
   * cap, the global byte budget, and the per-key fair share
   * `floor(globalCap / activeKeys)` have headroom; the first item that would
   * breach any of them stops the push. Returns how many were accepted vs
   * rejected (rejected => the caller answers 429).
   */
  push({ key, items }: { key: string; items: TItem[] }): BufferPushResult {
    if (items.length === 0) {
      return this.dropOldest
        ? { accepted: 0, rejected: 0, dropped: 0 }
        : { accepted: 0, rejected: 0 };
    }

    let bucket = this.keys.get(key);
    if (!bucket) {
      bucket = [];
      this.keys.set(key, bucket);
    }

    if (this.dropOldest) return this.pushDropOldest({ key, items, bucket });

    const activeKeys = this.keys.size;
    const perKeyCap = Math.max(1, Math.floor(this.globalCap / activeKeys));

    let accepted = 0;
    for (const item of items) {
      if (this.total >= this.globalCap || bucket.length >= perKeyCap) break;
      const itemBytes = this.estimateBytes(item);
      // Always admit at least one item even if it alone exceeds the byte budget,
      // so a single fat item can never wedge the buffer permanently.
      if (this.totalBytes + itemBytes > this.byteCap && this.total > 0) break;
      bucket.push(item);
      this.order.push(key);
      this.total += 1;
      this.totalBytes += itemBytes;
      accepted += 1;
    }
    // Clean up an empty bucket we speculatively created (keeps activeKeys and
    // fair-share accounting honest for the next push).
    if (bucket.length === 0) this.keys.delete(key);
    return { accepted, rejected: items.length - accepted };
  }

  /**
   * Drop-oldest push: every pushed item is admitted; when the item or byte cap
   * would be breached, the oldest buffered item (across all keys) is evicted
   * first. Fair-share does not apply here - drop-oldest is a single-writer
   * backpressure mode, not a contention arbiter. Returns `dropped` = number of
   * items evicted (which may include earlier items of THIS same push when the
   * push alone exceeds capacity - the newest items win).
   */
  private pushDropOldest({
    key,
    items,
    bucket,
  }: {
    key: string;
    items: TItem[];
    bucket: TItem[];
  }): BufferPushResult {
    let dropped = 0;
    const droppedByKey: Record<string, number> = {};
    for (const item of items) {
      const itemBytes = this.estimateBytes(item);
      while (
        this.total > 0 &&
        (this.total >= this.globalCap ||
          this.totalBytes + itemBytes > this.byteCap)
      ) {
        const evictedKey = this.evictOldest();
        if (evictedKey !== undefined) {
          droppedByKey[evictedKey] = (droppedByKey[evictedKey] ?? 0) + 1;
        }
        dropped += 1;
      }
      bucket.push(item);
      this.order.push(key);
      this.total += 1;
      this.totalBytes += itemBytes;
    }
    return dropped > 0
      ? { accepted: items.length, rejected: 0, dropped, droppedByKey }
      : { accepted: items.length, rejected: 0, dropped: 0 };
  }

  /**
   * Evict the single oldest buffered item (across all keys) and return the key
   * it belonged to (or undefined if the buffer was empty / drifted), so callers
   * can attribute the loss per key.
   */
  private evictOldest(): string | undefined {
    const oldestKey = this.order.shift();
    if (oldestKey === undefined) return undefined;
    const b = this.keys.get(oldestKey);
    if (!b || b.length === 0) return undefined;
    const removed = b.shift() as TItem;
    this.total -= 1;
    this.totalBytes -= this.estimateBytes(removed);
    if (b.length === 0) this.keys.delete(oldestKey);
    return oldestKey;
  }

  /**
   * Remove and return up to `maxItems` items (and at most ~`maxBytes`) in
   * global FIFO order, leaving the remainder buffered. Always returns at least
   * one item when the buffer is non-empty, so a lone item larger than `maxBytes`
   * can never wedge the drain. Used by the agent's credit-window sender to carve
   * one bounded batch at a time. Returns a flat, oldest-first list.
   */
  drainChunk({
    maxItems,
    maxBytes,
  }: {
    maxItems: number;
    maxBytes: number;
  }): TItem[] {
    const out: TItem[] = [];
    let bytes = 0;
    while (this.total > 0 && out.length < maxItems) {
      const oldestKey = this.order[0];
      const b =
        oldestKey === undefined ? undefined : this.keys.get(oldestKey);
      if (b && b.length > 0) {
        const itemBytes = this.estimateBytes(b[0] as TItem);
        // Stop before exceeding the byte budget, but always take at least one.
        if (out.length > 0 && bytes + itemBytes > maxBytes) break;
        this.order.shift();
        const item = b.shift() as TItem;
        if (b.length === 0) this.keys.delete(oldestKey as string);
        this.total -= 1;
        this.totalBytes -= itemBytes;
        out.push(item);
        bytes += itemBytes;
      } else {
        // Order/bucket drift guard - drop the stale order entry and continue.
        this.order.shift();
      }
    }
    return out;
  }

  /** Remove and return all buffered items grouped by key, resetting size + bytes. */
  drain(): Map<string, TItem[]> {
    const drained = this.keys.size > 0 ? new Map(this.keys) : new Map<string, TItem[]>();
    this.keys.clear();
    this.order.length = 0;
    this.total = 0;
    this.totalBytes = 0;
    return drained;
  }
}
