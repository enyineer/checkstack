import { IngestBuffer } from "@checkstack/ingest-utils";
import {
  TELEMETRY_MAX_INFLIGHT,
  TELEMETRY_BATCH_MAX_ITEMS,
  TELEMETRY_BATCH_MAX_BYTES,
  TELEMETRY_ACK_TIMEOUT_MS,
  TELEMETRY_PUMP_INTERVAL_MS,
  type TelemetryBatchMessage,
  type TelemetryAckMessage,
} from "@checkstack/satellite-common";

/**
 * Default per-kind agent buffer caps. Generous item/byte bounds so short
 * offline windows are absorbed; drop-oldest sheds the excess and counts it.
 */
const DEFAULT_BUFFER_ITEM_CAP = 50_000;
const DEFAULT_BUFFER_BYTE_CAP = 64 * 1024 * 1024;

/** Group items by their loss-attribution key, preserving per-key FIFO order. */
function groupItemsByKey(
  items: unknown[],
  groupKeyOf: (item: unknown) => string,
): Map<string, unknown[]> {
  const byKey = new Map<string, unknown[]>();
  for (const item of items) {
    const key = groupKeyOf(item);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(item);
    else byKey.set(key, [item]);
  }
  return byKey;
}

/** Fold a buffer push's per-key eviction counts into a running per-group map. */
function foldDropsByKey(
  target: Map<string, number>,
  droppedByKey: Record<string, number> | undefined,
): void {
  if (!droppedByKey) return;
  for (const [key, count] of Object.entries(droppedByKey)) {
    target.set(key, (target.get(key) ?? 0) + count);
  }
}

interface Logger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  debug: (msg: string) => void;
}

interface TelemetryClientConfig {
  /** Sends a telemetry_batch over the live socket (no-op if disconnected). */
  send: (msg: TelemetryBatchMessage) => void;
  logger?: Logger;
  maxInflight?: number;
  batchMaxItems?: number;
  batchMaxBytes?: number;
  bufferItemCap?: number;
  bufferByteCap?: number;
  ackTimeoutMs?: number;
  pumpIntervalMs?: number;
  /** First retryable-ack backoff delay; doubles each consecutive retry. */
  retryBackoffBaseMs?: number;
  /** Cap on the retryable-ack backoff delay. */
  retryBackoffMaxMs?: number;
}

/**
 * Default retryable-ack backoff. A retryable ack arrives the instant the core
 * sheds a batch (bytes/min budget exceeded, or a sink threw), so an immediate
 * synchronous resend would tight-loop at RTT speed and amplify load exactly when
 * the core is asking us to back off. We pace resends with exponential backoff
 * from 1s up to this cap instead; the counter resets when the batch resolves.
 */
const DEFAULT_RETRY_BACKOFF_BASE_MS = 1000;
const DEFAULT_RETRY_BACKOFF_MAX_MS = 30_000;

/** Per-kind state: the bounded buffer, its estimator, and its per-group drops. */
interface KindState {
  buffer: IngestBuffer<unknown>;
  estimateBytes: (item: unknown) => number;
  /** Derives the loss-attribution group key (e.g. stream token) for an item. */
  groupKeyOf: (item: unknown) => string;
  /**
   * Items the bounded buffer dropped since the last batch, keyed by the group
   * (stream token / scrape target) the loss belongs to, so the core can surface
   * it on the exact stream that lost data instead of spreading one aggregate
   * across every stream in the batch.
   */
  droppedByGroup: Map<string, number>;
}

/** An in-flight (sent, unacked) batch, retained for resend by batchId. */
interface InflightBatch {
  kind: string;
  items: unknown[];
  msg: TelemetryBatchMessage;
  timer: ReturnType<typeof setTimeout> | undefined;
  /** Consecutive retryable acks for this batch; drives the resend backoff. */
  retryCount: number;
}

/**
 * Agent-side telemetry sender. Buffers normalized items per kind (bounded,
 * drop-oldest), then forwards them to the core over the existing satellite
 * socket under a credit window: at most `maxInflight` unacked batches, each
 * chunked to the item/byte caps, with a monotonic per-connection batchId and
 * resend-until-ack. Buffer overflow is shed drop-oldest and counted PER GROUP,
 * ridden on the next batch's `droppedByGroup` so the core attributes the loss to
 * the exact stream. A terminal ack's `rejected` is a core-side outcome (surfaced
 * by the core per stream), not a satellite in-transit drop, so it is not counted
 * here.
 *
 * STATE & SCALE: all state here is pod-local transport bookkeeping on a single
 * agent process. It is never a queryable source of truth - the durable record
 * of forwarded telemetry lives in the core's domain tables after ingest.
 *
 * This class is DELIBERATELY generic: `payload` is the drained array of enqueued
 * items (opaque here). SAT-B's receivers decide the item shape and the matching
 * core capability handler for the kind interprets it.
 */
export class TelemetryClient {
  private readonly config: TelemetryClientConfig;
  private readonly maxInflight: number;
  private readonly batchMaxItems: number;
  private readonly batchMaxBytes: number;
  private readonly bufferItemCap: number;
  private readonly bufferByteCap: number;
  private readonly ackTimeoutMs: number;
  private readonly pumpIntervalMs: number;
  private readonly retryBackoffBaseMs: number;
  private readonly retryBackoffMaxMs: number;

  private readonly kinds = new Map<string, KindState>();
  private readonly inflight = new Map<string, InflightBatch>();
  private connected = false;
  /** Monotonic batchId counter, reset per connection. */
  private nextBatchSeq = 0;
  private pumpTimer: ReturnType<typeof setInterval> | undefined;

  constructor(config: TelemetryClientConfig) {
    this.config = config;
    this.maxInflight = config.maxInflight ?? TELEMETRY_MAX_INFLIGHT;
    this.batchMaxItems = config.batchMaxItems ?? TELEMETRY_BATCH_MAX_ITEMS;
    this.batchMaxBytes = config.batchMaxBytes ?? TELEMETRY_BATCH_MAX_BYTES;
    this.bufferItemCap = config.bufferItemCap ?? DEFAULT_BUFFER_ITEM_CAP;
    this.bufferByteCap = config.bufferByteCap ?? DEFAULT_BUFFER_BYTE_CAP;
    this.ackTimeoutMs = config.ackTimeoutMs ?? TELEMETRY_ACK_TIMEOUT_MS;
    this.pumpIntervalMs = config.pumpIntervalMs ?? TELEMETRY_PUMP_INTERVAL_MS;
    this.retryBackoffBaseMs =
      config.retryBackoffBaseMs ?? DEFAULT_RETRY_BACKOFF_BASE_MS;
    this.retryBackoffMaxMs =
      config.retryBackoffMaxMs ?? DEFAULT_RETRY_BACKOFF_MAX_MS;
  }

  /**
   * Enqueue normalized items for a kind. Bounded + drop-oldest: under sustained
   * backpressure the oldest items are shed and counted PER GROUP (rides the next
   * batch's `droppedByGroup`), so the loss is attributed to the stream that
   * actually lost data. Items are bucketed in the buffer under their group key
   * (`groupKeyOf`) so eviction is naturally per-group. The FIRST enqueue for a
   * kind fixes its byte estimator and group-key deriver.
   */
  enqueue(input: {
    kind: string;
    items: unknown[];
    estimateBytes: (item: unknown) => number;
    /**
     * Derives the loss-attribution group key for an item (e.g. its stream token
     * or scrape target id). Buffered items are keyed by this so a drop is
     * charged to the right stream, not spread across the batch.
     */
    groupKeyOf: (item: unknown) => string;
  }): void {
    if (input.items.length === 0) return;
    const state = this.getOrCreateKind(
      input.kind,
      input.estimateBytes,
      input.groupKeyOf,
    );
    for (const [key, items] of groupItemsByKey(input.items, state.groupKeyOf)) {
      const res = state.buffer.push({ key, items });
      foldDropsByKey(state.droppedByGroup, res.droppedByKey);
    }
    // Opportunistically pump so a burst does not wait for the next tick.
    if (this.connected) this.pumpOnce();
  }

  /** Start the periodic pump. Sends only while connected. */
  start(): void {
    if (this.pumpTimer) return;
    this.pumpTimer = setInterval(() => {
      if (this.connected) this.pumpOnce();
    }, this.pumpIntervalMs);
  }

  /** Stop the pump and clear all resend timers (does not clear buffers). */
  stop(): void {
    if (this.pumpTimer) {
      clearInterval(this.pumpTimer);
      this.pumpTimer = undefined;
    }
    for (const batch of this.inflight.values()) {
      if (batch.timer) clearTimeout(batch.timer);
    }
  }

  /** Mark the socket connected and pump immediately. */
  onConnected(): void {
    this.connected = true;
    this.pumpOnce();
  }

  /**
   * Mark the socket disconnected. Requeue every in-flight batch's items back
   * into their buffers (drop-oldest may shed some, counted), then reset the
   * in-flight set and the batchId counter so the NEXT connection starts a fresh
   * dedupe space (the core dedupes per connection).
   */
  onDisconnected(): void {
    this.connected = false;
    for (const batch of this.inflight.values()) {
      if (batch.timer) clearTimeout(batch.timer);
      const state = this.kinds.get(batch.kind);
      if (!state) continue;
      // The batch snapshotted its per-group drop counts onto its envelope (and
      // cleared the live map) when it was built. It never got acked, so fold
      // those counts back so they are reported on the next batch - otherwise a
      // disconnect before ack silently under-reports drops during exactly the
      // windows that drop the most.
      for (const [group, count] of Object.entries(batch.msg.droppedByGroup ?? {})) {
        state.droppedByGroup.set(
          group,
          (state.droppedByGroup.get(group) ?? 0) + count,
        );
      }
      // Requeue the unacked items under their group key; drop-oldest may shed
      // some, counted per group.
      for (const [key, items] of groupItemsByKey(batch.items, state.groupKeyOf)) {
        const res = state.buffer.push({ key, items });
        foldDropsByKey(state.droppedByGroup, res.droppedByKey);
      }
    }
    this.inflight.clear();
    this.nextBatchSeq = 0;
  }

  /** Process a telemetry_ack from the core. */
  handleAck(ack: TelemetryAckMessage): void {
    const batch = this.inflight.get(ack.batchId);
    if (!batch) return; // Already resolved (e.g. duplicate ack) - ignore.

    if (ack.retryable) {
      // Transient failure: resend the SAME batch (same batchId) - the core
      // dedupes, so re-processing is idempotent. A retryable ack means the core
      // is shedding load (budget exceeded / sink threw), so resend with
      // EXPONENTIAL BACKOFF rather than synchronously - an immediate resend would
      // tight-loop at RTT speed and pile on load exactly when asked to back off.
      batch.retryCount += 1;
      const delay = Math.min(
        this.retryBackoffBaseMs * 2 ** (batch.retryCount - 1),
        this.retryBackoffMaxMs,
      );
      this.config.logger?.debug(
        `Telemetry batch ${ack.batchId} (${batch.kind}) got a retryable ack; ` +
          `resending in ${delay}ms (attempt ${batch.retryCount})`,
      );
      this.scheduleResend(batch, delay);
      return;
    }

    // Terminal ack: the batch is resolved. `rejected` items were permanently
    // dropped by the CORE (e.g. auth-rejected). Those are a core-side outcome,
    // NOT a satellite in-transit drop, and the core attributes them per stream
    // itself (where a stream is resolvable) - so we do NOT fold them back into
    // this agent's per-group drop map, which would double-count and, for a
    // bad/unknown token, misattribute the loss to unrelated streams. We only log.
    if (ack.rejected > 0) {
      this.config.logger?.warn(
        `Core rejected ${ack.rejected} item(s) of telemetry batch ${ack.batchId} ` +
          `(${batch.kind}) as non-retryable; dropped`,
      );
    }
    if (batch.timer) clearTimeout(batch.timer);
    this.inflight.delete(ack.batchId);
    // Freed a credit slot - try to send more.
    if (this.connected) this.pumpOnce();
  }

  /**
   * Send as many batches as the credit window allows from whichever kinds have
   * buffered items. Public for deterministic testing (drive it instead of the
   * timer).
   */
  pumpOnce(): void {
    if (!this.connected) return;
    let madeProgress = true;
    while (madeProgress && this.inflight.size < this.maxInflight) {
      madeProgress = false;
      for (const [kind, state] of this.kinds) {
        if (this.inflight.size >= this.maxInflight) break;
        if (state.buffer.size === 0) continue;
        const items = state.buffer.drainChunk({
          maxItems: this.batchMaxItems,
          maxBytes: this.batchMaxBytes,
        });
        if (items.length === 0) continue;
        this.sendBatch(kind, state, items);
        madeProgress = true;
      }
    }
  }

  /** Total items dropped for a kind since its last successfully-built batch. */
  droppedSince(kind: string): number {
    const map = this.kinds.get(kind)?.droppedByGroup;
    if (!map) return 0;
    let total = 0;
    for (const count of map.values()) total += count;
    return total;
  }

  /**
   * Per-group drops for a kind since its last successfully-built batch (the
   * exact map that would ride the next batch's `droppedByGroup`). Exposed for
   * deterministic assertions on per-stream attribution.
   */
  droppedByGroup(kind: string): ReadonlyMap<string, number> {
    return this.kinds.get(kind)?.droppedByGroup ?? new Map();
  }

  /** Current number of in-flight (unacked) batches. */
  get inflightCount(): number {
    return this.inflight.size;
  }

  private getOrCreateKind(
    kind: string,
    estimateBytes: (item: unknown) => number,
    groupKeyOf: (item: unknown) => string,
  ): KindState {
    let state = this.kinds.get(kind);
    if (!state) {
      state = {
        buffer: new IngestBuffer<unknown>({
          estimateBytes,
          globalCap: this.bufferItemCap,
          byteCap: this.bufferByteCap,
          dropOldest: true,
        }),
        estimateBytes,
        groupKeyOf,
        droppedByGroup: new Map(),
      };
      this.kinds.set(kind, state);
    }
    return state;
  }

  /** Build, register (in-flight), and transmit one batch for a kind. */
  private sendBatch(
    kind: string,
    state: KindState,
    items: unknown[],
  ): void {
    const batchId = String(this.nextBatchSeq++);
    // Snapshot the per-group drop counts onto THIS batch and clear the live map,
    // so resends carry the same values and each count is reported exactly once.
    const droppedByGroup =
      state.droppedByGroup.size > 0
        ? Object.fromEntries(state.droppedByGroup)
        : undefined;
    state.droppedByGroup = new Map();
    const msg: TelemetryBatchMessage = {
      type: "telemetry_batch",
      batchId,
      kind,
      payload: items,
      ...(droppedByGroup ? { droppedByGroup } : {}),
    };
    const batch: InflightBatch = {
      kind,
      items,
      msg,
      timer: undefined,
      retryCount: 0,
    };
    this.inflight.set(batchId, batch);
    this.transmit(batch);
  }

  /** (Re)transmit an in-flight batch and (re)arm its ack-timeout resend. */
  private transmit(batch: InflightBatch): void {
    if (batch.timer) clearTimeout(batch.timer);
    batch.timer = setTimeout(() => {
      if (this.connected && this.inflight.has(batch.msg.batchId)) {
        this.config.logger?.debug(
          `Telemetry batch ${batch.msg.batchId} (${batch.kind}) ack timed out; resending`,
        );
        this.transmit(batch);
      }
    }, this.ackTimeoutMs);
    this.config.send(batch.msg);
  }

  /**
   * Schedule a paced resend of a batch after `delayMs` (a retryable-ack
   * backoff). Reuses `batch.timer`, replacing the ack-timeout; the resend
   * re-arms the ack-timeout via `transmit`. Does nothing while disconnected -
   * `onDisconnected` requeues the items instead.
   */
  private scheduleResend(batch: InflightBatch, delayMs: number): void {
    if (!this.connected) return;
    if (batch.timer) clearTimeout(batch.timer);
    batch.timer = setTimeout(() => {
      if (this.connected && this.inflight.has(batch.msg.batchId)) {
        this.transmit(batch);
      }
    }, delayMs);
  }
}
