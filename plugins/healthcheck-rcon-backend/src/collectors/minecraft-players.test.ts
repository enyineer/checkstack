import { describe, expect, it, mock } from "bun:test";
import { MinecraftPlayersCollector } from "./minecraft-players";
import type { RconTransportClient } from "@checkstack/healthcheck-rcon-common";

describe("MinecraftPlayersCollector", () => {
  const createMockClient = (response: string): RconTransportClient => ({
    exec: mock(() => Promise.resolve({ response })),
  });

  describe("execute", () => {
    it("should parse player list with players online", async () => {
      const collector = new MinecraftPlayersCollector();
      const client = createMockClient(
        "There are 3 of a max of 20 players online: Player1, Player2, Player3"
      );

      const result = await collector.execute({
        config: {},
        client,
        pluginId: "test",
      });

      expect(result.result.onlinePlayers).toBe(3);
      expect(result.result.maxPlayers).toBe(20);
      expect(result.result.playerNames).toEqual([
        "Player1",
        "Player2",
        "Player3",
      ]);
    });

    it("should parse empty player list", async () => {
      const collector = new MinecraftPlayersCollector();
      const client = createMockClient(
        "There are 0 of a max of 20 players online:"
      );

      const result = await collector.execute({
        config: {},
        client,
        pluginId: "test",
      });

      expect(result.result.onlinePlayers).toBe(0);
      expect(result.result.maxPlayers).toBe(20);
      expect(result.result.playerNames).toEqual([]);
    });

    it("should handle single player", async () => {
      const collector = new MinecraftPlayersCollector();
      const client = createMockClient(
        "There are 1 of a max of 100 players online: Steve"
      );

      const result = await collector.execute({
        config: {},
        client,
        pluginId: "test",
      });

      expect(result.result.onlinePlayers).toBe(1);
      expect(result.result.maxPlayers).toBe(100);
      expect(result.result.playerNames).toEqual(["Steve"]);
    });

    it("should call list command", async () => {
      const collector = new MinecraftPlayersCollector();
      const client = createMockClient(
        "There are 0 of a max of 20 players online:"
      );

      await collector.execute({
        config: {},
        client,
        pluginId: "test",
      });

      expect(client.exec).toHaveBeenCalledWith("list");
    });
  });

  describe("mergeResult", () => {
    it("should calculate average and max player counts", () => {
      const collector = new MinecraftPlayersCollector();
      const runs = [
        {
          id: "1",
          status: "healthy" as const,
          latencyMs: 100,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            onlinePlayers: 5,
            maxPlayers: 20,
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
            onlinePlayers: 15,
            maxPlayers: 20,
            playerNames: [],
          },
        },
      ];

      let aggregated = collector.mergeResult(undefined, runs[0]);
      aggregated = collector.mergeResult(aggregated, runs[1]);

      expect(aggregated.avgOnlinePlayers.avg).toBe(10);
      expect(aggregated.maxOnlinePlayers.max).toBe(15);
    });
  });

  describe("metadata", () => {
    it("should have correct static properties", () => {
      const collector = new MinecraftPlayersCollector();

      expect(collector.id).toBe("minecraft-players");
      expect(collector.displayName).toBe("Minecraft Players");
      expect(collector.allowMultiple).toBe(false);
    });
  });
});
