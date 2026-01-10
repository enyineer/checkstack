import { describe, expect, it, mock } from "bun:test";
import { MemoryCollector, type MemoryConfig } from "./memory";
import type { SshTransportClient } from "@checkstack/healthcheck-ssh-common";

describe("MemoryCollector", () => {
  const createMockClient = (
    freeOutput: string = `              total        used        free      shared  buff/cache   available
Mem:          16000        4000        8000         500        4000       12000
Swap:          4096         512        3584`
  ): SshTransportClient => ({
    exec: mock(() =>
      Promise.resolve({
        exitCode: 0,
        stdout: freeOutput,
        stderr: "",
      })
    ),
  });

  describe("execute", () => {
    it("should collect memory usage", async () => {
      const collector = new MemoryCollector();
      const client = createMockClient();

      const result = await collector.execute({
        config: { includeSwap: false, includeBuffersCache: false },
        client,
        pluginId: "test",
      });

      expect(result.result.totalMb).toBe(16000);
      expect(result.result.usedMb).toBe(4000);
      expect(result.result.freeMb).toBe(8000);
      expect(result.result.usedPercent).toBe(25);
    });

    it("should include swap when configured", async () => {
      const collector = new MemoryCollector();
      const client = createMockClient();

      const result = await collector.execute({
        config: { includeSwap: true, includeBuffersCache: false },
        client,
        pluginId: "test",
      });

      expect(result.result.swapTotalMb).toBe(4096);
      expect(result.result.swapUsedMb).toBe(512);
    });

    it("should not include swap when not configured", async () => {
      const collector = new MemoryCollector();
      const client = createMockClient();

      const result = await collector.execute({
        config: { includeSwap: false, includeBuffersCache: false },
        client,
        pluginId: "test",
      });

      expect(result.result.swapTotalMb).toBeUndefined();
      expect(result.result.swapUsedMb).toBeUndefined();
    });

    it("should call free -m command", async () => {
      const collector = new MemoryCollector();
      const client = createMockClient();

      await collector.execute({
        config: { includeSwap: false, includeBuffersCache: false },
        client,
        pluginId: "test",
      });

      expect(client.exec).toHaveBeenCalledWith("free -m");
    });
  });

  describe("aggregateResult", () => {
    it("should calculate average and max memory usage", () => {
      const collector = new MemoryCollector();
      const runs = [
        {
          id: "1",
          status: "healthy" as const,
          latencyMs: 100,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            totalMb: 16000,
            usedMb: 4000,
            freeMb: 12000,
            usedPercent: 25,
          },
        },
        {
          id: "2",
          status: "healthy" as const,
          latencyMs: 100,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            totalMb: 16000,
            usedMb: 12000,
            freeMb: 4000,
            usedPercent: 75,
          },
        },
      ];

      const aggregated = collector.aggregateResult(runs);

      expect(aggregated.avgUsedPercent).toBe(50);
      expect(aggregated.maxUsedPercent).toBe(75);
      expect(aggregated.avgUsedMb).toBe(8000);
    });
  });

  describe("metadata", () => {
    it("should have correct static properties", () => {
      const collector = new MemoryCollector();

      expect(collector.id).toBe("memory");
      expect(collector.displayName).toBe("Memory Metrics");
      expect(collector.supportedPlugins).toHaveLength(1);
    });
  });
});
