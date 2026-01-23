import { describe, expect, it, mock } from "bun:test";
import {
  RconHealthCheckStrategy,
  type RconClient,
  type RconConnection,
} from "./strategy";

describe("RconHealthCheckStrategy", () => {
  const createMockRconClient = (
    commandResponse: string = "OK",
  ): RconClient => ({
    connect: mock(() =>
      Promise.resolve<RconConnection>({
        command: mock(() => Promise.resolve(commandResponse)),
        disconnect: mock(),
      }),
    ),
  });

  describe("config validation", () => {
    it("should use default port 25575", () => {
      const strategy = new RconHealthCheckStrategy();
      const validated = strategy.config.validate({
        host: "localhost",
        password: "test",
      });
      expect(validated.port).toBe(25_575);
    });

    it("should use default timeout 10000ms", () => {
      const strategy = new RconHealthCheckStrategy();
      const validated = strategy.config.validate({
        host: "localhost",
        password: "test",
      });
      expect(validated.timeout).toBe(10_000);
    });

    it("should accept custom port", () => {
      const strategy = new RconHealthCheckStrategy();
      const validated = strategy.config.validate({
        host: "localhost",
        port: 27015,
        password: "test",
      });
      expect(validated.port).toBe(27015);
    });
  });

  describe("createClient", () => {
    it("should connect with provided config", async () => {
      const mockClient = createMockRconClient();
      const strategy = new RconHealthCheckStrategy(mockClient);

      const { close } = await strategy.createClient({
        host: "game.example.com",
        port: 25575,
        password: "secret",
        timeout: 5000,
      });

      expect(mockClient.connect).toHaveBeenCalledWith({
        host: "game.example.com",
        port: 25575,
        password: "secret",
        timeout: 5000,
      });

      close();
    });

    it("should execute commands through transport client", async () => {
      const mockClient = createMockRconClient("list response");
      const strategy = new RconHealthCheckStrategy(mockClient);

      const { client, close } = await strategy.createClient({
        host: "localhost",
        password: "test",
      });

      const result = await client.exec("list");
      expect(result.response).toBe("list response");

      close();
    });
  });

  describe("mergeResult", () => {
    it("should calculate averages and success rate", () => {
      const strategy = new RconHealthCheckStrategy();
      const runs = [
        {
          id: "1",
          status: "healthy" as const,
          latencyMs: 100,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            connected: true,
            connectionTimeMs: 50,
          },
        },
        {
          id: "2",
          status: "healthy" as const,
          latencyMs: 150,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            connected: true,
            connectionTimeMs: 100,
          },
        },
      ];

      let aggregated = strategy.mergeResult(undefined, runs[0]);
      aggregated = strategy.mergeResult(aggregated, runs[1]);

      expect(aggregated.avgConnectionTime.avg).toBe(75);
      expect(aggregated.maxConnectionTime.max).toBe(100);
      expect(aggregated.successRate.rate).toBe(100);
      expect(aggregated.errorCount.count).toBe(0);
    });

    it("should handle errors in aggregation", () => {
      const strategy = new RconHealthCheckStrategy();
      const runs = [
        {
          id: "1",
          status: "healthy" as const,
          latencyMs: 100,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            connected: true,
            connectionTimeMs: 50,
          },
        },
        {
          id: "2",
          status: "unhealthy" as const,
          latencyMs: 150,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            connected: false,
            connectionTimeMs: 0,
            error: "Connection refused",
          },
        },
      ];

      let aggregated = strategy.mergeResult(undefined, runs[0]);
      aggregated = strategy.mergeResult(aggregated, runs[1]);

      expect(aggregated.successRate.rate).toBe(50);
      expect(aggregated.errorCount.count).toBe(1);
    });

    it("should return zeros for empty metadata", () => {
      const strategy = new RconHealthCheckStrategy();
      const run = {
        id: "1",
        status: "healthy" as const,
        latencyMs: 100,
        checkId: "c1",
        timestamp: new Date(),
        metadata: { connected: false, connectionTimeMs: 0 },
      };
      const aggregated = strategy.mergeResult(undefined, run);

      expect(aggregated.avgConnectionTime.avg).toBe(0);
      expect(aggregated.maxConnectionTime.max).toBe(0);
      expect(aggregated.successRate.rate).toBe(0);
      expect(aggregated.errorCount.count).toBe(0);
    });
  });

  describe("metadata", () => {
    it("should have correct static properties", () => {
      const strategy = new RconHealthCheckStrategy();

      expect(strategy.id).toBe("rcon");
      expect(strategy.displayName).toBe("RCON Health Check");
    });
  });
});
