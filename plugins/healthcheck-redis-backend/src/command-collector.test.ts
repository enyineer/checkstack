import { describe, expect, it, mock } from "bun:test";
import { CommandCollector, type CommandConfig } from "./command-collector";
import type { RedisTransportClient } from "./transport-client";

describe("CommandCollector", () => {
  const createMockClient = (
    response: {
      value?: string;
      error?: string;
    } = {}
  ): RedisTransportClient => ({
    exec: mock(() =>
      Promise.resolve({
        value: response.value ?? "PONG",
        error: response.error,
      })
    ),
  });

  describe("execute", () => {
    it("should execute PING successfully", async () => {
      const collector = new CommandCollector();
      const client = createMockClient({ value: "PONG" });

      const result = await collector.execute({
        config: { command: "PING" },
        client,
        pluginId: "test",
      });

      expect(result.result.response).toBe("PONG");
      expect(result.result.success).toBe(true);
      expect(result.result.responseTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
    });

    it("should execute INFO with section", async () => {
      const collector = new CommandCollector();
      const client = createMockClient({ value: "redis_version:7.0.0" });

      const result = await collector.execute({
        config: { command: "INFO", args: "server" },
        client,
        pluginId: "test",
      });

      expect(result.result.response).toContain("redis_version");
      expect(result.result.success).toBe(true);
    });

    it("should return error for failed command", async () => {
      const collector = new CommandCollector();
      const client = createMockClient({ error: "NOAUTH" });

      const result = await collector.execute({
        config: { command: "PING" },
        client,
        pluginId: "test",
      });

      expect(result.result.success).toBe(false);
      expect(result.error).toBe("NOAUTH");
    });

    it("should pass correct parameters to client", async () => {
      const collector = new CommandCollector();
      const client = createMockClient();

      await collector.execute({
        config: { command: "GET", args: "mykey" },
        client,
        pluginId: "test",
      });

      expect(client.exec).toHaveBeenCalledWith({
        cmd: "GET",
        args: ["mykey"],
      });
    });
  });

  describe("mergeResult", () => {
    it("should calculate average response time and success rate", () => {
      const collector = new CommandCollector();
      const runs = [
        {
          id: "1",
          status: "healthy" as const,
          latencyMs: 10,
          checkId: "c1",
          timestamp: new Date(),
          metadata: { responseTimeMs: 5, success: true },
        },
        {
          id: "2",
          status: "healthy" as const,
          latencyMs: 15,
          checkId: "c1",
          timestamp: new Date(),
          metadata: { responseTimeMs: 15, success: true },
        },
      ];

      let aggregated = collector.mergeResult(undefined, runs[0]);
      aggregated = collector.mergeResult(aggregated, runs[1]);

      expect(aggregated.avgResponseTimeMs.avg).toBe(10);
      expect(aggregated.successRate.rate).toBe(100);
    });

    it("should calculate success rate correctly", () => {
      const collector = new CommandCollector();
      const runs = [
        {
          id: "1",
          status: "healthy" as const,
          latencyMs: 10,
          checkId: "c1",
          timestamp: new Date(),
          metadata: { responseTimeMs: 5, success: true },
        },
        {
          id: "2",
          status: "unhealthy" as const,
          latencyMs: 15,
          checkId: "c1",
          timestamp: new Date(),
          metadata: { responseTimeMs: 15, success: false },
        },
      ];

      let aggregated = collector.mergeResult(undefined, runs[0]);
      aggregated = collector.mergeResult(aggregated, runs[1]);

      expect(aggregated.successRate.rate).toBe(50);
    });
  });

  describe("metadata", () => {
    it("should have correct static properties", () => {
      const collector = new CommandCollector();

      expect(collector.id).toBe("command");
      expect(collector.displayName).toBe("Redis Command");
      expect(collector.allowMultiple).toBe(true);
      expect(collector.supportedPlugins).toHaveLength(1);
    });
  });
});
