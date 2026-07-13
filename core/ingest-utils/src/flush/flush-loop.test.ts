import { describe, it, expect } from "bun:test";
import { createFlushLoop } from "./flush-loop";

describe("createFlushLoop", () => {
  it("coalesces concurrent flushNow calls into one in-flight cycle", async () => {
    let runs = 0;
    let resolveCycle: (() => void) | null = null;
    const loop = createFlushLoop({
      runCycle: () => {
        runs += 1;
        return new Promise<void>((resolve) => {
          resolveCycle = resolve;
        });
      },
      intervalMs: 1000,
    });

    const a = loop.flushNow();
    const b = loop.flushNow();
    expect(a).toBe(b); // same in-flight promise
    expect(runs).toBe(1);

    resolveCycle!();
    await a;
  });

  it("runs a fresh cycle after the previous one settles", async () => {
    let runs = 0;
    const loop = createFlushLoop({
      runCycle: async () => {
        runs += 1;
      },
      intervalMs: 1000,
    });

    await loop.flushNow();
    await loop.flushNow();
    expect(runs).toBe(2);
  });

  it("clears the in-flight guard even when a cycle rejects", async () => {
    let runs = 0;
    const loop = createFlushLoop({
      runCycle: async () => {
        runs += 1;
        throw new Error("boom");
      },
      intervalMs: 1000,
    });

    await expect(loop.flushNow()).rejects.toThrow("boom");
    await expect(loop.flushNow()).rejects.toThrow("boom");
    expect(runs).toBe(2); // guard reset after the first rejection
  });

  it("start drives periodic cycles and stop halts them", async () => {
    let runs = 0;
    const loop = createFlushLoop({
      runCycle: async () => {
        runs += 1;
      },
      intervalMs: 5,
    });

    loop.start();
    loop.start(); // idempotent - a second start does not add a timer
    await new Promise((resolve) => setTimeout(resolve, 30));
    loop.stop();
    const afterStop = runs;
    expect(afterStop).toBeGreaterThan(0);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(runs).toBe(afterStop); // no further cycles after stop
  });
});
