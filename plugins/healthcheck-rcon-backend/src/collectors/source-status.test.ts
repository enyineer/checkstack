import { describe, expect, it, mock } from "bun:test";
import { SourceStatusCollector } from "./source-status";
import type { RconTransportClient } from "@checkstack/healthcheck-rcon-common";

describe("SourceStatusCollector", () => {
  const createMockClient = (response: string): RconTransportClient => ({
    exec: mock(() => Promise.resolve({ response })),
  });

  describe("execute", () => {
    it("should parse full status response", async () => {
      const collector = new SourceStatusCollector();
      const client = createMockClient(`hostname: "My CS:GO Server"
version : 1.38.5.0/13850 1341/8012 secure
map     : de_dust2
players : 8 humans, 2 bots (24 max)
# userid name uniqueid connected ping loss state rate`);

      const result = await collector.execute({
        config: {},
        client,
        pluginId: "test",
      });

      expect(result.result.hostname).toBe("My CS:GO Server");
      expect(result.result.version).toBe("1.38.5.0/13850 1341/8012 secure");
      expect(result.result.map).toBe("de_dust2");
      expect(result.result.humanPlayers).toBe(8);
      expect(result.result.botPlayers).toBe(2);
      expect(result.result.maxPlayers).toBe(24);
    });

    it("should handle empty server", async () => {
      const collector = new SourceStatusCollector();
      const client = createMockClient(`hostname: "Empty Server"
version : 1.38.5.0/13850 1341/8012 secure
map     : cs_office
players : 0 humans, 0 bots (32 max)`);

      const result = await collector.execute({
        config: {},
        client,
        pluginId: "test",
      });

      expect(result.result.hostname).toBe("Empty Server");
      expect(result.result.humanPlayers).toBe(0);
      expect(result.result.botPlayers).toBe(0);
      expect(result.result.maxPlayers).toBe(32);
    });

    it("should handle single player", async () => {
      const collector = new SourceStatusCollector();
      const client = createMockClient(`hostname: "Test Server"
players : 1 human, 0 bots (16 max)`);

      const result = await collector.execute({
        config: {},
        client,
        pluginId: "test",
      });

      expect(result.result.humanPlayers).toBe(1);
      expect(result.result.botPlayers).toBe(0);
    });

    it("should call status command", async () => {
      const collector = new SourceStatusCollector();
      const client = createMockClient("");

      await collector.execute({
        config: {},
        client,
        pluginId: "test",
      });

      expect(client.exec).toHaveBeenCalledWith("status");
    });
  });

  describe("mergeResult", () => {
    it("should calculate average and max player counts", () => {
      const collector = new SourceStatusCollector();
      const runs = [
        {
          id: "1",
          status: "healthy" as const,
          latencyMs: 100,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            humanPlayers: 5,
            botPlayers: 0,
            maxPlayers: 24,
          },
        },
        {
          id: "2",
          status: "healthy" as const,
          latencyMs: 150,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            humanPlayers: 15,
            botPlayers: 2,
            maxPlayers: 24,
          },
        },
      ];

      let aggregated = collector.mergeResult(undefined, runs[0]);
      aggregated = collector.mergeResult(aggregated, runs[1]);

      expect(aggregated.avgHumanPlayers.avg).toBe(10);
      expect(aggregated.maxHumanPlayers.max).toBe(15);
    });
  });

  describe("metadata", () => {
    it("should have correct static properties", () => {
      const collector = new SourceStatusCollector();

      expect(collector.id).toBe("source-status");
      expect(collector.displayName).toBe("Source Server Status");
      expect(collector.allowMultiple).toBe(false);
    });
  });
});
