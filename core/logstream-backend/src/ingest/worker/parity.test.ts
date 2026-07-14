import { describe, it, expect } from "bun:test";
import { createHash } from "node:crypto";
import { createMockLogger } from "@checkstack/test-utils-backend";
import {
  DEFAULT_LOG_STREAM_CONFIG,
  SEVERITY_NUMBER_FOR_BAND,
  type IngestedLine,
  type LogStreamConfig,
  type SeverityBand,
} from "@checkstack/logstream-common";
import { createDrainEngine, type DrainPatternRow } from "../../drain/engine";
import {
  createInProcessFlushExecutor,
  type FlushExecutor,
} from "../flush-executor";
import { createWorkerFlushExecutor } from "./pool";

/**
 * WORKER <-> IN-PROCESS PARITY: the same batch, seeds and mutations must produce
 * byte-identical {@link FlushPlan}s whether classified in-process or inside a REAL
 * Bun worker. This is the guarantee the whole Phase-D offload rests on - the two
 * executors are interchangeable - so the fixture deliberately spans the tricky
 * fold paths: a user (protected) pattern, mined patterns seeded via hydration,
 * numeric AND non-numeric `<*>` wildcard values, and a severity patternOverride
 * that re-bands a line by its classified pattern id.
 */

const STREAM_ID = "parity";
const USER_TEMPLATE = "user <*> logged in";

/** Same derivation as the engine: sha256(streamId + " " + template). */
function patternId(template: string): string {
  return createHash("sha256")
    .update(STREAM_ID)
    .update(" ")
    .update(template)
    .digest("hex");
}

function line(band: SeverityBand, body: string): IngestedLine {
  return {
    ts: new Date(100 * 60_000),
    observedAt: new Date(100 * 60_000),
    severityNumber: SEVERITY_NUMBER_FOR_BAND[band],
    band,
    body,
  };
}

// Mined templates the tree is hydrated with (ids are ignored for mined seeds, but
// we compute the real ones so the fixture reads honestly).
const SEED_ROWS: DrainPatternRow[] = [
  { id: patternId("request took <*> ms"), template: "request took <*> ms", origin: "mined", hidden: false },
  { id: patternId("cache miss for <*>"), template: "cache miss for <*>", origin: "mined", hidden: false },
];

const LINES: IngestedLine[] = [
  line("warn", "request took 100 ms"), // numeric wildcard 100
  line("warn", "request took 250 ms"), // numeric wildcard 250
  line("warn", "cache miss for foo"), // non-numeric wildcard (skipped in fold)
  line("error", "cache miss for bar"), // non-numeric wildcard
  line("info", "user 42 logged in"), // user pattern; numeric 42; overridden -> error
];

// Re-band the user pattern to `error` by its classified id (exercises the
// patternOverride path). Every line is now WARN+ so raw sampling keeps all of
// them deterministically (no rng), which is what makes the plans comparable.
const CONFIG: LogStreamConfig = {
  ...DEFAULT_LOG_STREAM_CONFIG,
  severityRules: {
    patternOverrides: [{ patternId: patternId(USER_TEMPLATE), band: "error" }],
  },
};

const PREPARE_ARGS = {
  streamId: STREAM_ID,
  lines: LINES,
  config: CONFIG,
  now: new Date(100 * 60_000),
  flushIntervalMs: 500,
};

const loadPatternRows = async (): Promise<DrainPatternRow[]> => [...SEED_ROWS];

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

describe("worker/in-process flush parity", () => {
  it(
    "produces identical FlushPlans from the in-process and real-worker executors",
    async () => {
      // In-process executor over an engine that hydrates from the SAME rows.
      const inProcess = createInProcessFlushExecutor({
        drain: createDrainEngine({ loadPatternRows }),
        logger: createMockLogger(),
      });
      // Real Bun-worker executor, same injected hydration loader.
      const worker = createWorkerFlushExecutor({
        poolSize: 1,
        loadPatternRows,
        fallback: unusedFallback,
        logger: createMockLogger(),
      });

      try {
        // Install the user pattern on BOTH trees before the flush (the worker
        // proxies it into the owning worker; both apply it before classifying).
        inProcess.upsertUserPattern({ streamId: STREAM_ID, template: USER_TEMPLATE });
        worker.upsertUserPattern({ streamId: STREAM_ID, template: USER_TEMPLATE });

        const [inProcessPlan, workerPlan] = await Promise.all([
          inProcess.prepare(PREPARE_ARGS),
          worker.prepare(PREPARE_ARGS),
        ]);

        // The whole plan must match: pattern upserts, severity/pattern/variable
        // deltas, sampled event rows, worst band, error delta and rate estimate.
        expect(workerPlan).toEqual(inProcessPlan);

        // Sanity anchors so a mutually-consistent-but-wrong plan can't pass:
        // the numeric folds (100+250 for request, 42 for user) are present, and
        // the override drove worst band to error.
        expect(inProcessPlan.worstBand).toBe("error");
        expect(inProcessPlan.errorDelta).toBe(2); // cache-bar + overridden user line
        expect(inProcessPlan.eventRows).toHaveLength(LINES.length); // all WARN+ kept
        const requestVar = inProcessPlan.variableDeltas.find(
          (d) => d.patternId === patternId("request took <*> ms"),
        );
        expect(requestVar).toMatchObject({ count: 2, sum: 350, min: 100, max: 250 });
        const userVar = inProcessPlan.variableDeltas.find(
          (d) => d.patternId === patternId(USER_TEMPLATE),
        );
        expect(userVar).toMatchObject({ count: 1, sum: 42 });
      } finally {
        await Promise.all([inProcess.stop(), worker.stop()]);
      }
    },
    15_000,
  );
});
