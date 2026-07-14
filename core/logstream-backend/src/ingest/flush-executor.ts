/**
 * The flush EXECUTOR seam: the stage of a flush that can run either on the main
 * thread (in-process) or, sharded by stream, inside a Bun worker pool (plan §5,
 * Phase D). It owns exactly the CPU-heavy, pod-local classification work:
 *
 *   hydrate the stream's Drain tree -> classify + fold + sample every buffered
 *   line -> return a {@link FlushPlan}
 *
 * and the three Drain-tree MUTATIONS that must reach wherever the tree lives:
 * user-pattern upsert/remove and the healthcheck-referenced protected set.
 *
 * Everything AROUND this stays on the main thread and is NOT part of the
 * executor: HTTP auth/parse/normalize, rate limiting, the write buffer + 429
 * backpressure, the DB write of the returned plan, spike detection, important
 * events, the fast-path hook, signals. That split is what lets the executor move
 * off-thread WITHOUT changing any external behavior - the plan crosses the
 * boundary as a structured-cloneable value and the main thread writes it exactly
 * as it does today.
 *
 * TWO IMPLEMENTATIONS:
 * - {@link createInProcessFlushExecutor} keeps the Drain tree + sampler on the
 *   main thread and runs {@link prepareFlush} inline. It IS the pre-Phase-D code
 *   path verbatim, so it is what the unit suite exercises and the fallback used
 *   when a worker cannot be constructed. Zero behavior change.
 * - the worker pool (`./worker/pool`) shards the same work across Bun workers,
 *   each owning the Drain trees for the streams that hash to it, and returns the
 *   plan by `postMessage`. See that module for the message protocol.
 */

import type { IngestedLine, LogStreamConfig } from "@checkstack/logstream-common";
import type { Logger } from "@checkstack/backend-api";
import type { DrainEngine } from "../drain/engine";
import { RawSampler } from "./sampler";
import { prepareFlush, type FlushPlan } from "./flush";

/**
 * The offloadable stage of a flush. `prepare` produces the plan for a stream's
 * buffered lines; the three mutation methods keep the owning Drain tree in sync
 * with pattern/protection changes that originate on the main thread (API writes,
 * cross-pod `patterns.changed` broadcasts, healthcheck-reference refreshes).
 *
 * All methods are async-tolerant so a worker-backed implementation can await a
 * round-trip; the in-process implementation resolves synchronously.
 */
export interface FlushExecutor {
  /**
   * Classify + fold + sample a stream's buffered lines into a {@link FlushPlan}.
   * Owns hydration of the stream's Drain tree (lazy, idempotent). Rejects only
   * if classification itself fails - the caller treats a rejection as a
   * transport-style flush drop (bounded loss), exactly as today.
   */
  prepare(input: {
    streamId: string;
    lines: IngestedLine[];
    config: LogStreamConfig;
    now: Date;
    flushIntervalMs: number;
  }): Promise<FlushPlan>;

  /** Install a user-authored protected cluster in the owning tree. Idempotent. */
  upsertUserPattern(input: { streamId: string; template: string }): void;

  /** Drop a user-authored cluster from the owning tree. Idempotent. */
  removeUserPattern(input: { streamId: string; patternId: string }): void;

  /** Replace a stream's healthcheck-referenced protected id set on the owning tree. */
  setProtectedPatterns(input: {
    streamId: string;
    patternIds: readonly string[];
  }): void;

  /** Mark a pattern hidden/visible on the owning tree's engine. Idempotent. */
  setPatternHidden(input: {
    streamId: string;
    patternId: string;
    hidden: boolean;
  }): void;

  /**
   * The current "protection epoch" for a stream: a counter the executor bumps
   * whenever the tree hosting `streamId` is RESET and its
   * {@link setProtectedPatterns} state is lost - a worker respawn after a crash,
   * or a dead worker's streams being handed to the in-process fallback. The
   * ingest pipeline folds this into the key it uses to decide whether to re-push
   * a stream's referenced protected set, so a reset forces the next flush to
   * re-push (self-healing the protection a fresh, empty tree would otherwise drop
   * indefinitely). The in-process executor never resets, so it returns a constant
   * `0`.
   */
  protectionEpoch(input: { streamId: string }): number;

  /**
   * Drain and stop the executor. The in-process executor has nothing to drain
   * (the main-thread flush loop already awaited every plan), so this is a no-op;
   * the worker pool runs a final flush of each worker's in-memory tree state and
   * terminates the workers.
   */
  stop(): Promise<void>;
}

/**
 * The main-thread executor: the Drain tree and sampler live in this process and
 * {@link prepareFlush} runs inline. This is the exact pre-Phase-D behavior, so it
 * backs the unit suite and is the fallback when the worker pool is disabled or a
 * worker fails to construct.
 *
 * A hydration failure is logged and swallowed (the flush proceeds against an
 * un-seeded tree, which simply re-mines and converges) - matching the pipeline's
 * historical hydrate-then-classify handling, just relocated behind the seam.
 */
export function createInProcessFlushExecutor({
  drain,
  logger,
  rng,
}: {
  drain: DrainEngine;
  logger: Logger;
  rng?: () => number;
}): FlushExecutor {
  const sampler = new RawSampler(rng);

  return {
    async prepare({ streamId, lines, config, now, flushIntervalMs }) {
      try {
        await drain.hydrateStream({ streamId });
      } catch (error) {
        logger.warn(
          `logstream: hydrate failed for ${streamId}: ${String(error)}`,
        );
      }
      return prepareFlush({
        streamId,
        lines,
        drain,
        sampler,
        config,
        now,
        flushIntervalMs,
      });
    },

    upsertUserPattern({ streamId, template }) {
      drain.upsertUserPattern({ streamId, template });
    },

    removeUserPattern({ streamId, patternId }) {
      drain.removeUserPattern({ streamId, patternId });
    },

    setProtectedPatterns({ streamId, patternIds }) {
      drain.setProtectedPatterns({ streamId, patternIds });
    },

    setPatternHidden({ streamId, patternId, hidden }) {
      drain.setPatternHidden({ streamId, patternId, hidden });
    },

    // The in-process tree lives for the pod's lifetime and is never reset, so
    // its protection epoch is a constant.
    protectionEpoch() {
      return 0;
    },

    stop() {
      return Promise.resolve();
    },
  };
}
