import { describe, it, expect } from "bun:test";
import type { SatellitePullExecutor } from "@checkstack/telemetry-common";
import { TelemetryPullExecutorRegistry } from "./executor-registry";

const executor = (sourceTypeId: string): SatellitePullExecutor => ({
  sourceTypeId,
  execute: async () => ({}),
});

describe("TelemetryPullExecutorRegistry", () => {
  it("registers and resolves an executor by source type id", () => {
    const registry = new TelemetryPullExecutorRegistry();
    const edge = executor("p.edge");
    registry.register(edge);
    expect(registry.get("p.edge")).toBe(edge);
    expect(registry.get("p.other")).toBeUndefined();
    expect(registry.list()).toEqual([edge]);
  });

  it("throws on a duplicate registration", () => {
    const registry = new TelemetryPullExecutorRegistry();
    registry.register(executor("p.edge"));
    expect(() => registry.register(executor("p.edge"))).toThrow(/duplicate/i);
  });
});
