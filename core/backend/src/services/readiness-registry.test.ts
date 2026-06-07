import { describe, it, expect, beforeEach, mock, afterAll } from "bun:test";
import {
  CoreReadinessRegistry,
  createScopedReadinessRegistry,
} from "./readiness-registry";
import { createMockLogger } from "@checkstack/test-utils-backend";
import * as realLogger from "../logger";

// Snapshot the real logger before mocking; restore it in afterAll so the stub
// does not leak into later core/backend suites (mock.module is process-global
// and mock.restore() does not undo it).
const realLoggerModule = { ...realLogger };

const mockLogger = createMockLogger();
mock.module("../logger", () => ({
  rootLogger: mockLogger,
}));

afterAll(() => {
  mock.module("../logger", () => realLoggerModule);
});

describe("CoreReadinessRegistry", () => {
  let registry: CoreReadinessRegistry;

  beforeEach(() => {
    registry = new CoreReadinessRegistry();
  });

  it("starts empty", () => {
    expect(registry.isEmpty()).toBe(true);
  });

  it("evaluates to ready=true with no probes", async () => {
    const snapshot = await registry.evaluate();
    expect(snapshot.ready).toBe(true);
    expect(snapshot.checks).toHaveLength(0);
  });

  it("aggregates passing probes", async () => {
    registry.register({
      name: "db",
      check: async () => ({ ok: true }),
    });
    registry.register({
      name: "queue",
      check: async () => ({ ok: true }),
    });
    const snapshot = await registry.evaluate();
    expect(snapshot.ready).toBe(true);
    expect(snapshot.checks).toHaveLength(2);
    expect(snapshot.checks.every((c) => c.ok)).toBe(true);
  });

  it("ready=false when a critical probe fails", async () => {
    registry.register({
      name: "db",
      check: async () => ({ ok: false, message: "down" }),
    });
    const snapshot = await registry.evaluate();
    expect(snapshot.ready).toBe(false);
    expect(snapshot.checks[0].message).toBe("down");
  });

  it("ready=true when only a non-critical probe fails", async () => {
    registry.register({
      name: "warmup",
      critical: false,
      check: async () => ({ ok: false }),
    });
    registry.register({
      name: "db",
      check: async () => ({ ok: true }),
    });
    const snapshot = await registry.evaluate();
    expect(snapshot.ready).toBe(true);
  });

  it("treats thrown probes as failed and surfaces the error", async () => {
    registry.register({
      name: "boom",
      check: async () => {
        throw new Error("kaboom");
      },
    });
    const snapshot = await registry.evaluate();
    expect(snapshot.ready).toBe(false);
    expect(snapshot.checks[0].ok).toBe(false);
    expect(snapshot.checks[0].error).toBe("kaboom");
  });

  it("overwrites duplicate names with a warning", async () => {
    registry.register({
      name: "db",
      check: async () => ({ ok: false }),
    });
    registry.register({
      name: "db",
      check: async () => ({ ok: true }),
    });
    const snapshot = await registry.evaluate();
    expect(snapshot.checks).toHaveLength(1);
    expect(snapshot.checks[0].ok).toBe(true);
  });

  it("runs probes in parallel (total time ~ slowest probe)", async () => {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    registry.register({
      name: "slow-1",
      check: async () => {
        await delay(50);
        return { ok: true };
      },
    });
    registry.register({
      name: "slow-2",
      check: async () => {
        await delay(50);
        return { ok: true };
      },
    });
    const start = Date.now();
    await registry.evaluate();
    const elapsed = Date.now() - start;
    // Sequential would be ~100ms; parallel should be ~50ms.
    expect(elapsed).toBeLessThan(95);
  });

  it("scoped registry forwards register() to the global", () => {
    const scoped = createScopedReadinessRegistry(registry);
    scoped.register({ name: "x", check: async () => ({ ok: true }) });
    expect(registry.isEmpty()).toBe(false);
  });
});
