import { describe, it, expect } from "bun:test";
import type { TelemetrySource } from "@checkstack/telemetry-common";
import { deriveSourceHealth } from "./source-health.logic";

const runAt = new Date("2026-07-14T10:00:00Z");
const updatedAt = new Date("2026-07-14T09:00:00Z");

const source = (over: Partial<TelemetrySource>): TelemetrySource => ({
  id: "s1",
  sourceTypeId: "demo.poller",
  name: "prod",
  description: null,
  config: {},
  storedSecretFields: [],
  bindings: [{ signal: "metrics", streamId: "stream-1" }],
  bindingStreamNames: {},
  enabled: true,
  intervalSeconds: null,
  satelliteId: null,
  lastRunAt: null,
  lastError: null,
  consecutiveFailures: 0,
  createdAt: updatedAt,
  updatedAt,
  ...over,
});

describe("deriveSourceHealth", () => {
  it("is healthy with no consecutive failures", () => {
    const health = deriveSourceHealth(source({ lastRunAt: runAt }));
    expect(health.failing).toBe(false);
    expect(health.timeLabel).toBe("ran");
    expect(health.timeAt).toBe(runAt);
  });

  it("is failing and surfaces the error and count", () => {
    const health = deriveSourceHealth(
      source({ consecutiveFailures: 3, lastError: "connect ECONNREFUSED", lastRunAt: runAt }),
    );
    expect(health.failing).toBe(true);
    expect(health.consecutiveFailures).toBe(3);
    expect(health.lastError).toBe("connect ECONNREFUSED");
  });

  it("falls back to updatedAt when the source has never run", () => {
    const health = deriveSourceHealth(source({ lastRunAt: null }));
    expect(health.timeLabel).toBe("updated");
    expect(health.timeAt).toBe(updatedAt);
  });
});
