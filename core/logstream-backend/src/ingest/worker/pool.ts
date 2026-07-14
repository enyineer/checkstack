/**
 * The stream-sharded ingest worker pool (plan §5, Phase D): a {@link FlushExecutor}
 * that runs the offloadable flush stage on Bun worker threads instead of the main
 * thread, WITHOUT changing any external behavior. The main thread still owns HTTP
 * auth/parse/normalize, rate limiting, the write buffer + 429 backpressure, every
 * DB write, signals and the fast-path hook; only classify + fold + sample move.
 *
 * SHARDING: `worker = hash(streamId) % poolSize`, so each stream's Drain tree
 * lives in exactly ONE worker and its convergence semantics are identical to the
 * single-tree-per-pod behavior of the in-process path. Default `poolSize` is 1.
 *
 * HYDRATION: workers hold no DB connection. When a worker must seed a stream's
 * tree it sends a hydrate-request; the main thread runs the pattern-row query
 * ({@link LoadPatternRows}) and returns the rows. A stale response (the worker
 * respawned meanwhile) is dropped - the fresh worker re-requests.
 *
 * CRASH RECOVERY: on a worker error/exit its in-flight flushes are REJECTED (the
 * pipeline then drops those batches and counts the lines, exactly as a failed DB
 * write does today - bounded loss), and the worker is respawned with an empty
 * tree that lazily re-hydrates from Postgres. A worker that crash-loops past a
 * budget is declared dead and its streams fall back to the in-process executor,
 * so ingestion degrades gracefully rather than wedging.
 *
 * TESTABILITY: the Bun-`Worker` transport is injected ({@link WorkerTransport}),
 * so the pool's sharding, hydration round-trip, crash/respawn and teardown are
 * unit-tested with a deterministic fake - no real threads required.
 */

import type { Logger } from "@checkstack/backend-api";
import type { DrainPatternRow, LoadPatternRows } from "../../drain/engine";
import type { FlushPlan } from "../flush";
import type { FlushExecutor } from "../flush-executor";
import type {
  MainToWorkerMessage,
  WorkerToMainMessage,
  RequestId,
} from "./protocol";

/**
 * The transport to one worker: post a message, observe messages/errors, and
 * terminate. Abstracted so tests inject a fake and production wraps a Bun
 * `Worker`. `onMessage`/`onError` are each set once, right after construction.
 */
export interface WorkerTransport {
  post(message: MainToWorkerMessage): void;
  onMessage(handler: (message: WorkerToMainMessage) => void): void;
  onError(handler: (error: Error) => void): void;
  terminate(): void;
}

export type SpawnWorkerTransport = (index: number) => WorkerTransport;

/** How many crashes within {@link CRASH_WINDOW_MS} declare a worker permanently dead. */
const MAX_CRASHES = 5;
const CRASH_WINDOW_MS = 60_000;
/** How long `stop()` waits for a worker's `stopped` ack before terminating anyway. */
const STOP_ACK_TIMEOUT_MS = 2000;

interface PendingFlush {
  resolve: (plan: FlushPlan) => void;
  reject: (error: Error) => void;
  streamId: string;
}

interface Slot {
  index: number;
  transport: WorkerTransport;
  pendingFlushes: Map<RequestId, PendingFlush>;
  pendingStop: { resolve: () => void } | null;
  /** Recent crash timestamps within the window (older ones pruned). */
  crashes: number[];
  /** Permanently degraded: route this slot's streams to the fallback executor. */
  dead: boolean;
  /**
   * Bumped every time this slot's tree state is lost - a respawn (fresh worker,
   * empty tree) or the transition to `dead` (streams handed to the fallback,
   * whose tree lacks this slot's referenced sets). Surfaced via
   * {@link FlushExecutor.protectionEpoch} so the pipeline re-pushes the referenced
   * protected set to the fresh tree on the next flush.
   */
  epoch: number;
}

/** FNV-1a 32-bit hash - stable, fast, dependency-free; only used for sharding. */
export function hashStreamId(streamId: string): number {
  let h = 0x81_1C_9D_C5;
  for (let i = 0; i < streamId.length; i++) {
    h ^= streamId.codePointAt(i) ?? 0;
    h = Math.imul(h, 0x01_00_01_93);
  }
  return h >>> 0;
}

/**
 * Build the default Bun-`Worker` transport for one pool slot. Loads
 * `worker-entry.ts` as an ES-module worker and bridges its web-`Worker` events to
 * the {@link WorkerTransport} shape. Kept separate so {@link createWorkerFlushExecutor}
 * stays thread-free and unit-testable.
 */
export function createBunWorkerTransport(): WorkerTransport {
  const worker = new Worker(
    new URL("worker-entry.ts", import.meta.url).href,
    { type: "module" },
  );
  return {
    post: (message) => worker.postMessage(message),
    onMessage: (handler) => {
      worker.addEventListener("message", (event: MessageEvent<WorkerToMainMessage>) =>
        handler(event.data),
      );
    },
    onError: (handler) => {
      worker.addEventListener("error", (event: ErrorEvent) =>
        handler(new Error(event.message || "worker error")),
      );
      // A worker that exits (uncaught async, OOM) fires `close`; treat as a crash.
      worker.addEventListener("close", () =>
        handler(new Error("worker exited")),
      );
    },
    terminate: () => worker.terminate(),
  };
}

/**
 * Create a worker-pool {@link FlushExecutor}. `loadPatternRows` runs on the MAIN
 * thread to answer worker hydrate-requests (it is the same DB query the
 * in-process engine uses). `fallback` is the in-process executor a dead slot's
 * streams are routed to. `spawn` is injectable for tests; it defaults to a real
 * Bun worker transport.
 */
export function createWorkerFlushExecutor({
  poolSize,
  loadPatternRows,
  fallback,
  logger,
  spawn = createBunWorkerTransport,
}: {
  poolSize: number;
  loadPatternRows: LoadPatternRows;
  fallback: FlushExecutor;
  logger: Logger;
  spawn?: SpawnWorkerTransport;
}): FlushExecutor {
  if (poolSize < 1) {
    throw new Error(`createWorkerFlushExecutor: poolSize must be >= 1, got ${poolSize}`);
  }

  let flushSeq = 0;
  let stopSeq = 0;

  const slots: Slot[] = Array.from({ length: poolSize }, (_, index) =>
    createSlot(index),
  );

  /** Wire one transport's handlers, capturing THAT transport for the stale-guard. */
  function wire(slot: Slot, transport: WorkerTransport): void {
    transport.onMessage((message) => handleMessage(slot, transport, message));
    transport.onError((error) => handleCrash(slot, transport, error));
  }

  function createSlot(index: number): Slot {
    const transport = spawn(index);
    const slot: Slot = {
      index,
      transport,
      pendingFlushes: new Map(),
      pendingStop: null,
      crashes: [],
      dead: false,
      epoch: 0,
    };
    wire(slot, transport);
    return slot;
  }

  /** Replace a slot's dead worker with a fresh one (empty tree, lazy re-hydrate). */
  function respawn(slot: Slot): void {
    const transport = spawn(slot.index);
    slot.transport = transport;
    wire(slot, transport);
  }

  function handleMessage(
    slot: Slot,
    transport: WorkerTransport,
    message: WorkerToMainMessage,
  ): void {
    switch (message.type) {
      case "ready": {
        return;
      }
      case "flush-result": {
        const pending = slot.pendingFlushes.get(message.requestId);
        if (pending) {
          slot.pendingFlushes.delete(message.requestId);
          pending.resolve(message.plan);
        }
        return;
      }
      case "flush-error": {
        const pending = slot.pendingFlushes.get(message.requestId);
        if (pending) {
          slot.pendingFlushes.delete(message.requestId);
          pending.reject(new Error(message.message));
        }
        return;
      }
      case "hydrate-request": {
        void answerHydrate(slot, transport, message.requestId, message.streamId);
        return;
      }
      case "stopped": {
        slot.pendingStop?.resolve();
        slot.pendingStop = null;
        return;
      }
    }
  }

  async function answerHydrate(
    slot: Slot,
    transport: WorkerTransport,
    requestId: RequestId,
    streamId: string,
  ): Promise<void> {
    let rows: DrainPatternRow[];
    try {
      rows = await loadPatternRows({ streamId });
    } catch (error) {
      // Only answer if this worker is still the live one (else it respawned and
      // will re-request); a stale id could otherwise collide with the fresh
      // worker's own hydrate sequence.
      if (slot.transport === transport) {
        transport.post({ type: "hydrate-error", requestId, message: String(error) });
      }
      return;
    }
    if (slot.transport === transport) {
      transport.post({ type: "hydrate-response", requestId, rows });
    }
  }

  function handleCrash(
    slot: Slot,
    transport: WorkerTransport,
    error: Error,
  ): void {
    // Ignore events from a transport we already replaced (error + close can both
    // fire for one death).
    if (slot.transport !== transport) return;

    // This slot's tree state is gone (a respawn gets an empty tree; going dead
    // hands its streams to the fallback tree). Bump the epoch so the pipeline
    // re-pushes each affected stream's referenced protected set on the next
    // flush - whether to the fresh worker or to the fallback.
    slot.epoch++;

    // Reject in-flight flushes: the pipeline drops those batches and counts the
    // lines (bounded loss, same class as a failed DB write today).
    const inFlight = slot.pendingFlushes.size;
    for (const pending of slot.pendingFlushes.values()) {
      pending.reject(new Error(`ingest worker ${slot.index} crashed: ${error.message}`));
    }
    slot.pendingFlushes.clear();
    slot.pendingStop?.resolve();
    slot.pendingStop = null;

    try {
      transport.terminate();
    } catch {
      // already dead
    }

    const now = Date.now();
    slot.crashes = slot.crashes.filter((t) => now - t < CRASH_WINDOW_MS);
    slot.crashes.push(now);

    if (slot.crashes.length >= MAX_CRASHES) {
      slot.dead = true;
      logger.error(
        `logstream: ingest worker ${slot.index} exceeded crash budget (${MAX_CRASHES} in ${CRASH_WINDOW_MS}ms); routing its streams to the in-process fallback`,
      );
      return;
    }

    logger.error(
      `logstream: ingest worker ${slot.index} crashed, dropped ${inFlight} in-flight flush(es), respawning: ${error.message}`,
    );
    // Fresh worker, empty tree; it lazily re-hydrates from Postgres on next flush.
    respawn(slot);
  }

  function slotFor(streamId: string): Slot {
    return slots[hashStreamId(streamId) % poolSize]!;
  }

  return {
    prepare({ streamId, lines, config, now, flushIntervalMs }) {
      const slot = slotFor(streamId);
      if (slot.dead) {
        return fallback.prepare({ streamId, lines, config, now, flushIntervalMs });
      }
      const requestId = ++flushSeq;
      const promise = new Promise<FlushPlan>((resolve, reject) => {
        slot.pendingFlushes.set(requestId, { resolve, reject, streamId });
      });
      const message: MainToWorkerMessage = {
        type: "flush",
        requestId,
        streamId,
        lines,
        config,
        nowMs: now.getTime(),
        flushIntervalMs,
      };
      slot.transport.post(message);
      return promise;
    },

    upsertUserPattern({ streamId, template }) {
      const slot = slotFor(streamId);
      if (slot.dead) {
        fallback.upsertUserPattern({ streamId, template });
        return;
      }
      slot.transport.post({ type: "upsert-user-pattern", streamId, template });
    },

    removeUserPattern({ streamId, patternId }) {
      const slot = slotFor(streamId);
      if (slot.dead) {
        fallback.removeUserPattern({ streamId, patternId });
        return;
      }
      slot.transport.post({ type: "remove-user-pattern", streamId, patternId });
    },

    setProtectedPatterns({ streamId, patternIds }) {
      const slot = slotFor(streamId);
      if (slot.dead) {
        fallback.setProtectedPatterns({ streamId, patternIds });
        return;
      }
      slot.transport.post({ type: "set-protected-patterns", streamId, patternIds });
    },

    setPatternHidden({ streamId, patternId, hidden }) {
      const slot = slotFor(streamId);
      if (slot.dead) {
        fallback.setPatternHidden({ streamId, patternId, hidden });
        return;
      }
      slot.transport.post({
        type: "set-pattern-hidden",
        streamId,
        patternId,
        hidden,
      });
    },

    protectionEpoch({ streamId }) {
      // The owning slot's epoch even when dead: it was bumped on the transition
      // to dead, so the pipeline re-pushes the referenced set to the fallback.
      return slotFor(streamId).epoch;
    },

    async stop() {
      await Promise.all(
        slots.map((slot) => (slot.dead ? Promise.resolve() : stopSlot(slot))),
      );
      await fallback.stop();
    },
  };

  function stopSlot(slot: Slot): Promise<void> {
    const requestId = ++stopSeq;
    const ack = new Promise<void>((resolve) => {
      slot.pendingStop = { resolve };
    });
    slot.transport.post({ type: "stop", requestId });
    const timeout = new Promise<void>((resolve) =>
      setTimeout(resolve, STOP_ACK_TIMEOUT_MS),
    );
    return Promise.race([ack, timeout]).then(() => {
      try {
        slot.transport.terminate();
      } catch {
        // already gone
      }
    });
  }
}
