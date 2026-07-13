import { describe, it, expect, mock } from "bun:test";
import { createMockLogger } from "@checkstack/test-utils-backend";
import {
  DEFAULT_LOG_STREAM_CONFIG,
  SEVERITY_NUMBER_FOR_BAND,
  type IngestedLine,
  type SeverityBand,
} from "@checkstack/logstream-common";
import type { DrainEngine } from "../drain/engine";
import type { PatternUpsert } from "../storage";
import { createInProcessFlushExecutor } from "./flush-executor";

function line(band: SeverityBand, body: string): IngestedLine {
  return {
    ts: new Date(100 * 60_000),
    observedAt: new Date(100 * 60_000),
    severityNumber: SEVERITY_NUMBER_FOR_BAND[band],
    band,
    body,
  };
}

/** A drain whose classify masks digits to a stable pattern id, like the real one. */
function mockDrain(overrides: Partial<DrainEngine> = {}): DrainEngine {
  const pending: PatternUpsert[] = [];
  return {
    classify: ({ body }) => ({
      patternId: `p:${body.replace(/\d+/g, "<*>")}`,
      isNew: false,
      template: body,
      tokenCount: 1,
      severityNumber: 9,
      wildcardValues: [],
    }),
    pendingPatternUpserts: () => pending.splice(0),
    hydrateStream: async () => {},
    upsertUserPattern: ({ template }) => ({ patternId: `p:${template}` }),
    removeUserPattern: () => {},
    setProtectedPatterns: () => {},
    ...overrides,
  };
}

const PREPARE_ARGS = {
  streamId: "s1",
  config: DEFAULT_LOG_STREAM_CONFIG,
  now: new Date(100 * 60_000),
  flushIntervalMs: 500,
};

describe("createInProcessFlushExecutor", () => {
  it("hydrates then classifies + folds a batch into a plan", async () => {
    const hydrateStream = mock(async () => {});
    const executor = createInProcessFlushExecutor({
      drain: mockDrain({ hydrateStream }),
      logger: createMockLogger(),
    });

    const plan = await executor.prepare({
      ...PREPARE_ARGS,
      lines: [line("info", "a"), line("error", "boom 1")],
    });

    expect(hydrateStream).toHaveBeenCalledTimes(1);
    expect(hydrateStream).toHaveBeenCalledWith({ streamId: "s1" });
    expect(plan.streamId).toBe("s1");
    expect(plan.linesClassified).toBe(2);
    expect(plan.worstBand).toBe("error");
    expect(plan.errorDelta).toBe(1);
    // One severity bucket per line (both landed in the same minute).
    const severityTotal = plan.severityDeltas.reduce((s, d) => s + d.count, 0);
    expect(severityTotal).toBe(2);
  });

  it("swallows a hydration failure and still classifies (converges by re-mining)", async () => {
    const logger = createMockLogger();
    const executor = createInProcessFlushExecutor({
      drain: mockDrain({
        hydrateStream: async () => {
          throw new Error("db down");
        },
      }),
      logger,
    });

    const plan = await executor.prepare({
      ...PREPARE_ARGS,
      lines: [line("info", "a")],
    });

    expect(plan.linesClassified).toBe(1);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("delegates the three tree mutations to the drain engine", () => {
    const upsertUserPattern = mock(({ template }: { template: string }) => ({
      patternId: `p:${template}`,
    }));
    const removeUserPattern = mock(() => {});
    const setProtectedPatterns = mock(() => {});
    const executor = createInProcessFlushExecutor({
      drain: mockDrain({ upsertUserPattern, removeUserPattern, setProtectedPatterns }),
      logger: createMockLogger(),
    });

    executor.upsertUserPattern({ streamId: "s1", template: "user <*> in" });
    executor.removeUserPattern({ streamId: "s1", patternId: "p:x" });
    executor.setProtectedPatterns({ streamId: "s1", patternIds: ["p:a", "p:b"] });

    expect(upsertUserPattern).toHaveBeenCalledWith({
      streamId: "s1",
      template: "user <*> in",
    });
    expect(removeUserPattern).toHaveBeenCalledWith({ streamId: "s1", patternId: "p:x" });
    expect(setProtectedPatterns).toHaveBeenCalledWith({
      streamId: "s1",
      patternIds: ["p:a", "p:b"],
    });
  });

  it("stop() resolves (nothing to drain in-process)", async () => {
    const executor = createInProcessFlushExecutor({
      drain: mockDrain(),
      logger: createMockLogger(),
    });
    await expect(executor.stop()).resolves.toBeUndefined();
  });
});
