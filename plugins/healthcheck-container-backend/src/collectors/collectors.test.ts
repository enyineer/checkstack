import { describe, expect, it } from "bun:test";
import type {
  ContainerCommand,
  ContainerCommandResult,
  ContainerTransportClient,
} from "@checkstack/healthcheck-container-common";
import { ContainerStatusCollector } from "./status-collector";
import { ContainerStatsCollector } from "./stats-collector";

/** A transport client whose exec returns fixed results per command type. */
function fakeClient(
  handler: (command: ContainerCommand) => ContainerCommandResult,
): ContainerTransportClient {
  return { exec: (command) => Promise.resolve(handler(command)) };
}

describe("ContainerStatusCollector", () => {
  const collector = new ContainerStatusCollector();

  it("reports a running container's state as assertable metrics, no error", async () => {
    const client = fakeClient(() => ({
      type: "inspect",
      exists: true,
      state: "running",
      running: true,
      health: "healthy",
      exitCode: 0,
      restartCount: 1,
      oomKilled: false,
    }));
    const { result, error } = await collector.execute({
      config: {},
      client,
      pluginId: "healthcheck-container",
    });
    expect(error).toBeUndefined();
    expect(result.exists).toBe(true);
    expect(result.running).toBe(true);
    expect(result.state).toBe("running");
    expect(result.health).toBe("healthy");
  });

  it("reports a STOPPED container as a successful collection (exitCode metric, no error)", async () => {
    const client = fakeClient(() => ({
      type: "inspect",
      exists: true,
      state: "exited",
      running: false,
      exitCode: 137,
      restartCount: 3,
      oomKilled: true,
    }));
    const { result, error } = await collector.execute({
      config: {},
      client,
      pluginId: "healthcheck-container",
    });
    // A stopped container is a completed inspect - assertions decide health.
    expect(error).toBeUndefined();
    expect(result.running).toBe(false);
    expect(result.state).toBe("exited");
    expect(result.exitCode).toBe(137);
    expect(result.oomKilled).toBe(true);
  });

  it("reports a MISSING container as exists:false, not an error", async () => {
    const client = fakeClient(() => ({ type: "inspect", exists: false }));
    const { result, error } = await collector.execute({
      config: {},
      client,
      pluginId: "healthcheck-container",
    });
    expect(error).toBeUndefined();
    expect(result.exists).toBe(false);
    expect(result.running).toBeUndefined();
  });

  it("aggregates running rate and average restart count", () => {
    const first = collector.mergeResult(undefined, {
      status: "healthy",
      metadata: { exists: true, running: true, restartCount: 2 },
    });
    const second = collector.mergeResult(first, {
      status: "unhealthy",
      metadata: { exists: true, running: false, restartCount: 4 },
    });
    expect(second.runningRate.rate).toBe(50);
    expect(second.avgRestartCount.avg).toBe(3);
  });
});

describe("ContainerStatsCollector", () => {
  const collector = new ContainerStatsCollector();

  it("maps cpu and memory metrics", async () => {
    const client = fakeClient(() => ({
      type: "stats",
      cpuPercent: 12.5,
      memoryPercent: 40,
      memoryUsageBytes: 400,
      memoryLimitBytes: 1000,
    }));
    const { result, error } = await collector.execute({
      config: {},
      client,
      pluginId: "healthcheck-container",
    });
    expect(error).toBeUndefined();
    expect(result.cpuPercent).toBe(12.5);
    expect(result.memoryPercent).toBe(40);
  });

  it("handles empty stats (stopped container) without error", async () => {
    const client = fakeClient(() => ({ type: "stats" }));
    const { result, error } = await collector.execute({
      config: {},
      client,
      pluginId: "healthcheck-container",
    });
    expect(error).toBeUndefined();
    expect(result.cpuPercent).toBeUndefined();
  });
});
