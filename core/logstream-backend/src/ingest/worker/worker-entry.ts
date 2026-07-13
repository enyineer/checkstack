/**
 * Ingest flush worker entry (plan §5, Phase D). Runs on a Bun worker thread; a
 * thin message loop over the SAME pure modules the main thread uses (no copies):
 * it hosts a {@link createDrainEngine} Drain engine and a {@link RawSampler} for
 * the streams that hash to this worker, and answers each
 * {@link MainFlushRequest} by running the shared {@link prepareFlush}.
 *
 * The worker holds NO database connection: when the Drain engine needs a stream's
 * persisted pattern rows it calls the injected {@link LoadPatternRows}, which
 * round-trips to the main thread ({@link WorkerHydrateRequest} ->
 * {@link MainHydrateResponse}); the main thread owns the DB pool. A hydration
 * failure is swallowed and classification proceeds unseeded (re-mining and
 * converging), exactly as the in-process executor handles it.
 *
 * FLUSH SERIALIZATION: the Drain engine's pending-pattern-upsert buffer is global
 * and drained once per {@link prepareFlush}, so flushes MUST NOT interleave. Flush
 * messages are therefore chained one-at-a-time here; hydrate responses and
 * tree-mutation messages are processed immediately (a hydrate response must not
 * queue behind the very flush that is awaiting it).
 */

import { parentPort } from "node:worker_threads";
import { createDrainEngine, type LoadPatternRows } from "../../drain/engine";
import { RawSampler } from "../sampler";
import { prepareFlush } from "../flush";
import type {
  MainToWorkerMessage,
  WorkerToMainMessage,
  RequestId,
} from "./protocol";

if (!parentPort) {
  throw new Error("worker-entry: must be run as a worker (no parentPort)");
}
const port = parentPort;

function post(message: WorkerToMainMessage): void {
  port.postMessage(message);
}

// Pending hydration round-trips, keyed by a worker-generated request id.
const pendingHydrations = new Map<
  RequestId,
  { resolve: (rows: Awaited<ReturnType<LoadPatternRows>>) => void; reject: (error: Error) => void }
>();
let hydrateSeq = 0;

const loadPatternRows: LoadPatternRows = ({ streamId }) =>
  new Promise((resolve, reject) => {
    const requestId = ++hydrateSeq;
    pendingHydrations.set(requestId, { resolve, reject });
    post({ type: "hydrate-request", requestId, streamId });
  });

// The engine runs with an INJECTED loader and none of the platform services
// (all unused today); it never touches a DB in this process.
const drain = createDrainEngine({ loadPatternRows });
const sampler = new RawSampler();

// Serialize flush handling on a single chain so no two prepareFlush runs
// interleave over the engine's shared pending buffer.
let flushChain: Promise<void> = Promise.resolve();

async function handleFlush(msg: Extract<MainToWorkerMessage, { type: "flush" }>): Promise<void> {
  try {
    // Hydration failure is non-fatal: classify unseeded and converge, matching
    // the in-process executor's hydrate-then-classify handling.
    try {
      await drain.hydrateStream({ streamId: msg.streamId });
    } catch {
      // swallowed - the tree re-mines this flush
    }
    const plan = await prepareFlush({
      streamId: msg.streamId,
      lines: msg.lines,
      drain,
      sampler,
      config: msg.config,
      now: new Date(msg.nowMs),
      flushIntervalMs: msg.flushIntervalMs,
    });
    post({ type: "flush-result", requestId: msg.requestId, plan });
  } catch (error) {
    post({ type: "flush-error", requestId: msg.requestId, message: String(error) });
  }
}

port.on("message", (msg: MainToWorkerMessage) => {
  switch (msg.type) {
    case "flush": {
      // Chain, but never reject the chain (handleFlush reports its own errors).
      flushChain = flushChain.then(() => handleFlush(msg));
      return;
    }
    case "upsert-user-pattern": {
      drain.upsertUserPattern({ streamId: msg.streamId, template: msg.template });
      return;
    }
    case "remove-user-pattern": {
      drain.removeUserPattern({ streamId: msg.streamId, patternId: msg.patternId });
      return;
    }
    case "set-protected-patterns": {
      drain.setProtectedPatterns({
        streamId: msg.streamId,
        patternIds: msg.patternIds,
      });
      return;
    }
    case "hydrate-response": {
      const pending = pendingHydrations.get(msg.requestId);
      if (pending) {
        pendingHydrations.delete(msg.requestId);
        pending.resolve(msg.rows);
      }
      return;
    }
    case "hydrate-error": {
      const pending = pendingHydrations.get(msg.requestId);
      if (pending) {
        pendingHydrations.delete(msg.requestId);
        pending.reject(new Error(msg.message));
      }
      return;
    }
    case "stop": {
      // The worker holds no buffer of its own (the main thread buffers and
      // awaits every flush), so there is nothing to drain - acknowledge and let
      // the main thread terminate us after any in-flight flush settles.
      const { requestId } = msg;
      flushChain = flushChain.then(() => {
        post({ type: "stopped", requestId });
      });
      return;
    }
  }
});

post({ type: "ready" });
