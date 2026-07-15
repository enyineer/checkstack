import { describe, it, expect } from "bun:test";
import {
  CapabilityIntervalScheduler,
  type RunOutcome,
} from "./interval-scheduler";

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

const flush = () => new Promise<void>((r) => setTimeout(r, 5));

interface Item {
  id: string;
  intervalSeconds: number;
}

const item = (id: string): Item => ({ id, intervalSeconds: 30 });

/**
 * These cover the SHARED branches neither concrete suite exercises: the
 * concurrency-cap skip (both suites cover the in-flight guard but never
 * saturate the cap) and the malformed-config early return.
 */
describe("CapabilityIntervalScheduler shared branches", () => {
  function harness(opts: {
    concurrency: number;
    runItem: (args: { config: Item }) => Promise<RunOutcome>;
  }) {
    const flushes: number[] = [];
    let flushCount = 0;
    const scheduler = new CapabilityIntervalScheduler<Item, { id: string }>({
      kind: "test.kind",
      label: "test",
      itemNoun: "item",
      logger: noopLogger,
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      concurrency: opts.concurrency,
      emitStatus: () => {},
      parseConfig: (payload) => {
        const p = payload as { items?: Item[] } | null;
        if (!p || !Array.isArray(p.items)) return { error: "bad" };
        return { items: p.items };
      },
      sameConfig: (a, b) => a.intervalSeconds === b.intervalSeconds,
      flushSecrets: () => {
        flushCount += 1;
        flushes.push(flushCount);
      },
      runItem: opts.runItem,
      buildStatus: ({ config }) => ({ id: config.id }),
    });
    return { scheduler, flushes: () => flushes };
  }

  it("skips a tick that would exceed the concurrency cap (not queued)", async () => {
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const { scheduler } = harness({
      concurrency: 1,
      runItem: async ({ config }) => {
        started.push(config.id);
        await gate; // hold the one allowed run in-flight
        return { ok: true };
      },
    });

    // Both items fire an immediate tick; with concurrency 1 the second is
    // skipped this tick (retried on the next interval), NOT queued behind the
    // first.
    scheduler.applyConfig({ items: [item("a"), item("b")] });
    await flush();
    expect(started).toEqual(["a"]);

    release();
    await flush();
    // "b" was skipped, not queued: it did not run once "a" released.
    expect(started).toEqual(["a"]);
    scheduler.stop();
  });

  it("flushes secrets on every applyConfig and on stop", async () => {
    const { scheduler, flushes } = harness({
      concurrency: 4,
      runItem: async () => ({ ok: true }),
    });
    scheduler.applyConfig({ items: [item("a")] });
    await flush();
    scheduler.applyConfig({ items: [item("a")] });
    scheduler.stop();
    // Two applyConfig pushes + one stop = three flushes.
    expect(flushes()).toEqual([1, 2, 3]);
  });

  it("ignores a malformed config payload", () => {
    const { scheduler, flushes } = harness({
      concurrency: 4,
      runItem: async () => ({ ok: true }),
    });
    scheduler.applyConfig({ nope: true });
    expect(scheduler.activeIds()).toEqual([]);
    // A malformed push does NOT flush (it returns before the reconcile).
    expect(flushes()).toEqual([]);
  });
});
