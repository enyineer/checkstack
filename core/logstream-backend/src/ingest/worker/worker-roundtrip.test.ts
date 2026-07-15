import { describe, it, expect, mock } from "bun:test";
import { createMockLogger } from "@checkstack/test-utils-backend";
import {
  DEFAULT_LOG_STREAM_CONFIG,
  SEVERITY_NUMBER_FOR_BAND,
  type IngestedLine,
} from "@checkstack/logstream-common";
import type { FlushExecutor } from "../flush-executor";
import { createWorkerFlushExecutor } from "./pool";

/**
 * End-to-end smoke test over a REAL Bun worker (no DB): proves the worker module
 * boots, the main<->worker message bridge works in both directions, a hydrate
 * round-trip is answered by the main-thread loader, and a real {@link prepareFlush}
 * runs in the worker and returns a usable plan. This is the integration proof the
 * load guard then leans on; it needs no Postgres, so it runs in the unit lane.
 */

// Deliberate starvation ceiling, not a masked determinism bug: the wait here is
// ALREADY terminal-signal-driven — `executor.prepare()` resolves on the worker's
// actual `flush-result` message, with no fixed sleep and no internal handshake
// deadline (pool.ts). What is genuinely heavy is spawning a REAL Bun worker and
// cold-loading its whole module graph (the drain engine + logstream-common),
// which runs in ~0.4s in isolation but has starved past the old 15s ceiling
// under the parallel suite. Sizing this well above the observed-under-load ~16s
// keeps scheduler starvation from reading as a failure while still failing fast
// on a genuinely wedged worker.
const WORKER_SPAWN_CEILING_MS = 60_000;

function line(body: string): IngestedLine {
  return {
    ts: new Date(60_000),
    observedAt: new Date(60_000),
    severityNumber: SEVERITY_NUMBER_FOR_BAND.error,
    band: "error",
    body,
  };
}

/** A fallback that must never be reached in the happy path. */
const unusedFallback: FlushExecutor = {
  prepare: () => {
    throw new Error("fallback.prepare should not run");
  },
  upsertUserPattern: () => {},
  removeUserPattern: () => {},
  setProtectedPatterns: () => {},
  setPatternHidden: () => {},
  protectionEpoch: () => 0,
  stop: async () => {},
};

describe("ingest worker (real Bun worker) round trip", () => {
  it(
    "classifies a batch in the worker and answers its hydrate-request from main",
    async () => {
      const loadPatternRows = mock(async () => []);
      const executor = createWorkerFlushExecutor({
        poolSize: 1,
        loadPatternRows,
        fallback: unusedFallback,
        logger: createMockLogger(),
      });

      try {
        const plan = await executor.prepare({
          streamId: "s1",
          lines: [line("payment 42 failed"), line("payment 99 failed")],
          config: DEFAULT_LOG_STREAM_CONFIG,
          now: new Date(60_000),
          flushIntervalMs: 500,
        });

        expect(plan.streamId).toBe("s1");
        expect(plan.linesClassified).toBe(2);
        expect(plan.worstBand).toBe("error");
        expect(plan.errorDelta).toBe(2);
        // Both bodies mask to the same template -> one pattern upsert.
        expect(plan.patternUpserts).toHaveLength(1);
        // The worker had to seed the (empty) tree, so it round-tripped to main.
        expect(loadPatternRows).toHaveBeenCalledWith({ streamId: "s1" });
      } finally {
        await executor.stop();
      }
    },
    WORKER_SPAWN_CEILING_MS,
  );

  it(
    "keeps a stream's tree in one worker across flushes (convergence)",
    async () => {
      const executor = createWorkerFlushExecutor({
        poolSize: 1,
        loadPatternRows: async () => [],
        fallback: unusedFallback,
        logger: createMockLogger(),
      });
      try {
        const args = {
          streamId: "s2",
          config: DEFAULT_LOG_STREAM_CONFIG,
          now: new Date(60_000),
          flushIntervalMs: 500,
        };
        const first = await executor.prepare({ ...args, lines: [line("db query 5 rows 3")] });
        const second = await executor.prepare({ ...args, lines: [line("db query 9 rows 7")] });
        // First flush creates the cluster; the second reuses it (no new cluster),
        // proving the tree persists in the same worker between flushes.
        expect(first.patternUpserts).toHaveLength(1);
        expect(second.patternUpserts).toHaveLength(1);
        expect(second.patternUpserts[0]!.id).toBe(first.patternUpserts[0]!.id);
      } finally {
        await executor.stop();
      }
    },
    WORKER_SPAWN_CEILING_MS,
  );
});
