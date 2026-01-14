import { describe, expect, it, mock } from "bun:test";
import { CommandCollector, type CommandConfig } from "./command-collector";
import type { RconTransportClient } from "@checkstack/healthcheck-rcon-common";

describe("CommandCollector", () => {
  const createMockClient = (response: string = ""): RconTransportClient => ({
    exec: mock(() => Promise.resolve({ response })),
  });

  describe("execute", () => {
    it("should execute command successfully", async () => {
      const collector = new CommandCollector();
      const client = createMockClient("Command executed successfully");

      const result = await collector.execute({
        config: { command: "list" },
        client,
        pluginId: "test",
      });

      expect(result.result.response).toBe("Command executed successfully");
      expect(result.result.executionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it("should pass command to client", async () => {
      const collector = new CommandCollector();
      const client = createMockClient();

      await collector.execute({
        config: { command: "status" },
        client,
        pluginId: "test",
      });

      expect(client.exec).toHaveBeenCalledWith("status");
    });
  });

  describe("aggregateResult", () => {
    it("should calculate average execution time", () => {
      const collector = new CommandCollector();
      const runs = [
        {
          id: "1",
          status: "healthy" as const,
          latencyMs: 100,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            response: "OK",
            executionTimeMs: 50,
          },
        },
        {
          id: "2",
          status: "healthy" as const,
          latencyMs: 150,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            response: "OK",
            executionTimeMs: 100,
          },
        },
      ];

      const aggregated = collector.aggregateResult(runs);

      expect(aggregated.avgExecutionTimeMs).toBe(75);
    });

    it("should return zero for empty runs", () => {
      const collector = new CommandCollector();
      const aggregated = collector.aggregateResult([]);

      expect(aggregated.avgExecutionTimeMs).toBe(0);
    });
  });

  describe("metadata", () => {
    it("should have correct static properties", () => {
      const collector = new CommandCollector();

      expect(collector.id).toBe("command");
      expect(collector.displayName).toBe("RCON Command");
      expect(collector.allowMultiple).toBe(true);
      expect(collector.supportedPlugins).toHaveLength(1);
    });
  });
});
