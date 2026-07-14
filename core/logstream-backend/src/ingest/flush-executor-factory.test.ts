import { describe, it, expect } from "bun:test";
import { createMockLogger } from "@checkstack/test-utils-backend";
import {
  DEFAULT_LOG_STREAM_CONFIG,
  SEVERITY_NUMBER_FOR_BAND,
  type IngestedLine,
} from "@checkstack/logstream-common";
import type { DrainEngine } from "../drain/engine";
import type { PatternUpsert, Storage } from "../storage";
import {
  resolveIngestWorkerCount,
  createFlushExecutor,
  INGEST_WORKERS_ENV,
} from "./flush-executor-factory";

function mockDrain(): DrainEngine {
  const pending: PatternUpsert[] = [];
  return {
    classify: ({ body }) => ({
      patternId: `p:${body}`,
      isNew: false,
      template: body,
      tokenCount: 1,
      severityNumber: 9,
      wildcardValues: [],
      hidden: false,
    }),
    pendingPatternUpserts: () => pending.splice(0),
    hydrateStream: async () => {},
    upsertUserPattern: ({ template }) => ({ patternId: `p:${template}` }),
    removeUserPattern: () => {},
    setProtectedPatterns: () => {},
    setPatternHidden: () => {},
  };
}

describe("resolveIngestWorkerCount", () => {
  const cases: Array<[string | undefined, number]> = [
    [undefined, 1], // default: one worker
    ["0", 0], // explicit in-process
    ["1", 1],
    ["4", 4],
    ["abc", 1], // malformed -> default
    ["-3", 1], // below min -> default
    ["999", 1], // above max -> default
  ];
  for (const [value, expected] of cases) {
    it(`${value ?? "(unset)"} -> ${expected}`, () => {
      const env = value === undefined ? {} : { [INGEST_WORKERS_ENV]: value };
      expect(resolveIngestWorkerCount(env)).toBe(expected);
    });
  }
});

describe("createFlushExecutor", () => {
  it("returns an in-process executor when workers are disabled (0)", async () => {
    const executor = createFlushExecutor({
      drain: mockDrain(),
      storage: {} as unknown as Storage,
      logger: createMockLogger(),
      env: { [INGEST_WORKERS_ENV]: "0" },
    });

    const line: IngestedLine = {
      ts: new Date(60_000),
      observedAt: new Date(60_000),
      severityNumber: SEVERITY_NUMBER_FOR_BAND.info,
      band: "info",
      body: "hello",
    };
    const plan = await executor.prepare({
      streamId: "s1",
      lines: [line],
      config: DEFAULT_LOG_STREAM_CONFIG,
      now: new Date(60_000),
      flushIntervalMs: 500,
    });
    // Classified in-process on the main-thread drain (no worker spawned).
    expect(plan.linesClassified).toBe(1);
    await executor.stop();
  });
});
