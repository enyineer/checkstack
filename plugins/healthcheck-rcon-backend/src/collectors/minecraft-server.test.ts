import { describe, expect, it, mock } from "bun:test";
import { MinecraftServerCollector } from "./minecraft-server";
import type { RconTransportClient } from "@checkstack/healthcheck-rcon-common";

describe("MinecraftServerCollector", () => {
  const createMockClient = (
    responses: Record<string, string> = {}
  ): RconTransportClient => ({
    exec: mock((cmd: string) =>
      Promise.resolve({ response: responses[cmd] ?? "" })
    ),
  });

  describe("execute", () => {
    it("should return empty result when TPS disabled", async () => {
      const collector = new MinecraftServerCollector();
      const client = createMockClient();

      const result = await collector.execute({
        config: { includeTps: false },
        client,
        pluginId: "test",
      });

      expect(result.result).toEqual({});
      expect(client.exec).not.toHaveBeenCalled();
    });

    it("should parse TPS from Paper/Spigot response", async () => {
      const collector = new MinecraftServerCollector();
      const client = createMockClient({
        tps: "TPS from last 1m, 5m, 15m: 19.5, 19.8, 20.0",
      });

      const result = await collector.execute({
        config: { includeTps: true },
        client,
        pluginId: "test",
      });

      expect(result.result.tps).toBe(19.5);
    });

    it("should handle colored TPS response", async () => {
      const collector = new MinecraftServerCollector();
      const client = createMockClient({
        tps: "§6TPS from last 1m, 5m, 15m: §a*20.0, §a*20.0, §a*20.0",
      });

      const result = await collector.execute({
        config: { includeTps: true },
        client,
        pluginId: "test",
      });

      expect(result.result.tps).toBe(20.0);
    });

    it("should handle TPS command failure gracefully", async () => {
      const collector = new MinecraftServerCollector();
      const client: RconTransportClient = {
        exec: mock(() => Promise.reject(new Error("Command not found"))),
      };

      const result = await collector.execute({
        config: { includeTps: true },
        client,
        pluginId: "test",
      });

      expect(result.result.tps).toBeUndefined();
    });
  });

  describe("aggregateResult", () => {
    it("should calculate average and min TPS", () => {
      const collector = new MinecraftServerCollector();
      const runs = [
        {
          id: "1",
          status: "healthy" as const,
          latencyMs: 100,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            tps: 20.0,
          },
        },
        {
          id: "2",
          status: "healthy" as const,
          latencyMs: 150,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            tps: 18.0,
          },
        },
      ];

      const aggregated = collector.aggregateResult(runs);

      expect(aggregated.avgTps).toBe(19.0);
      expect(aggregated.minTps).toBe(18.0);
    });

    it("should return zeros for empty runs", () => {
      const collector = new MinecraftServerCollector();
      const aggregated = collector.aggregateResult([]);

      expect(aggregated.avgTps).toBe(0);
      expect(aggregated.minTps).toBe(0);
    });
  });

  describe("metadata", () => {
    it("should have correct static properties", () => {
      const collector = new MinecraftServerCollector();

      expect(collector.id).toBe("minecraft-server");
      expect(collector.displayName).toBe("Minecraft Server");
      expect(collector.allowMultiple).toBe(false);
    });
  });
});
