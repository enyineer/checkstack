import { describe, expect, it, mock } from "bun:test";
import { SourcePlayersCollector } from "./source-players";
import type { RconTransportClient } from "@checkstack/healthcheck-rcon-common";

describe("SourcePlayersCollector", () => {
  const createMockClient = (response: string): RconTransportClient => ({
    exec: mock(() => Promise.resolve({ response })),
  });

  describe("execute", () => {
    it("should parse player list from status response", async () => {
      const collector = new SourcePlayersCollector();
      const client = createMockClient(`hostname: "Test Server"
version : 1.38.5.0/13850
players : 3 humans, 0 bots (24 max)
# userid name uniqueid connected ping loss state rate
# 2 "PlayerOne" STEAM_1:0:12345678 05:23 42 0 active 196608
# 5 "PlayerTwo" STEAM_1:1:23456789 02:15 55 0 active 196608
# 8 "PlayerThree" STEAM_1:0:34567890 00:45 38 0 active 196608`);

      const result = await collector.execute({
        config: {},
        client,
        pluginId: "test",
      });

      expect(result.result.playerCount).toBe(3);
      expect(result.result.playerNames).toEqual([
        "PlayerOne",
        "PlayerTwo",
        "PlayerThree",
      ]);
    });

    it("should handle empty player list", async () => {
      const collector = new SourcePlayersCollector();
      const client = createMockClient(`hostname: "Test Server"
players : 0 humans, 0 bots (24 max)
# userid name uniqueid connected ping loss state rate`);

      const result = await collector.execute({
        config: {},
        client,
        pluginId: "test",
      });

      expect(result.result.playerCount).toBe(0);
      expect(result.result.playerNames).toEqual([]);
    });

    it("should handle players with special characters in names", async () => {
      const collector = new SourcePlayersCollector();
      const client =
        createMockClient(`# userid name uniqueid connected ping loss state rate
# 2 "Player [TAG]" STEAM_1:0:12345678 05:23 42 0 active 196608`);

      const result = await collector.execute({
        config: {},
        client,
        pluginId: "test",
      });

      expect(result.result.playerNames).toEqual(["Player [TAG]"]);
    });

    it("should call status command", async () => {
      const collector = new SourcePlayersCollector();
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
      const collector = new SourcePlayersCollector();
      const runs = [
        {
          id: "1",
          status: "healthy" as const,
          latencyMs: 100,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            playerCount: 5,
            playerNames: [],
          },
        },
        {
          id: "2",
          status: "healthy" as const,
          latencyMs: 150,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            playerCount: 15,
            playerNames: [],
          },
        },
      ];

      let aggregated = collector.mergeResult(undefined, runs[0]);
      aggregated = collector.mergeResult(aggregated, runs[1]);

      expect(aggregated.avgPlayerCount.avg).toBe(10);
      expect(aggregated.maxPlayerCount.max).toBe(15);
    });
  });

  describe("metadata", () => {
    it("should have correct static properties", () => {
      const collector = new SourcePlayersCollector();

      expect(collector.id).toBe("source-players");
      expect(collector.displayName).toBe("Source Player List");
      expect(collector.allowMultiple).toBe(false);
    });
  });
});
