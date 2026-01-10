import { describe, expect, it, mock } from "bun:test";
import {
  RedisHealthCheckStrategy,
  RedisClient,
  RedisConnection,
} from "./strategy";

describe("RedisHealthCheckStrategy", () => {
  // Helper to create mock Redis connection
  const createMockConnection = (
    config: {
      pingResponse?: string;
      infoResponse?: string;
      pingError?: Error;
    } = {}
  ): RedisConnection => ({
    ping: mock(() =>
      config.pingError
        ? Promise.reject(config.pingError)
        : Promise.resolve(config.pingResponse ?? "PONG")
    ),
    info: mock(() =>
      Promise.resolve(
        config.infoResponse ?? "redis_version:7.0.0\r\nrole:master\r\n"
      )
    ),
    get: mock(() => Promise.resolve(undefined)),
    quit: mock(() => Promise.resolve("OK")),
  });

  // Helper to create mock Redis client
  const createMockClient = (
    config: {
      pingResponse?: string;
      infoResponse?: string;
      pingError?: Error;
      connectError?: Error;
    } = {}
  ): RedisClient => ({
    connect: mock(() =>
      config.connectError
        ? Promise.reject(config.connectError)
        : Promise.resolve(createMockConnection(config))
    ),
  });

  describe("createClient", () => {
    it("should return a connected client for successful connection", async () => {
      const strategy = new RedisHealthCheckStrategy(createMockClient());

      const connectedClient = await strategy.createClient({
        host: "localhost",
        port: 6379,
        timeout: 5000,
      });

      expect(connectedClient.client).toBeDefined();
      expect(connectedClient.client.exec).toBeDefined();
      expect(connectedClient.close).toBeDefined();

      connectedClient.close();
    });

    it("should throw for connection error", async () => {
      const strategy = new RedisHealthCheckStrategy(
        createMockClient({ connectError: new Error("Connection refused") })
      );

      await expect(
        strategy.createClient({
          host: "localhost",
          port: 6379,
          timeout: 5000,
        })
      ).rejects.toThrow("Connection refused");
    });
  });

  describe("client.exec", () => {
    it("should execute PING successfully", async () => {
      const strategy = new RedisHealthCheckStrategy(createMockClient());
      const connectedClient = await strategy.createClient({
        host: "localhost",
        port: 6379,
        timeout: 5000,
      });

      const result = await connectedClient.client.exec({ cmd: "PING" });

      expect(result.value).toBe("PONG");

      connectedClient.close();
    });

    it("should return error for ping failure", async () => {
      const strategy = new RedisHealthCheckStrategy(
        createMockClient({ pingError: new Error("NOAUTH") })
      );
      const connectedClient = await strategy.createClient({
        host: "localhost",
        port: 6379,
        timeout: 5000,
      });

      const result = await connectedClient.client.exec({ cmd: "PING" });

      expect(result.error).toContain("NOAUTH");

      connectedClient.close();
    });

    it("should return server info", async () => {
      const strategy = new RedisHealthCheckStrategy(createMockClient());
      const connectedClient = await strategy.createClient({
        host: "localhost",
        port: 6379,
        timeout: 5000,
      });

      const result = await connectedClient.client.exec({
        cmd: "INFO",
        args: ["server"],
      });

      expect(result.value).toContain("redis_version");

      connectedClient.close();
    });
  });

  describe("aggregateResult", () => {
    it("should calculate averages correctly", () => {
      const strategy = new RedisHealthCheckStrategy();
      const runs = [
        {
          id: "1",
          status: "healthy" as const,
          latencyMs: 10,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            connected: true,
            connectionTimeMs: 5,
            pingSuccess: true,
            role: "master",
          },
        },
        {
          id: "2",
          status: "healthy" as const,
          latencyMs: 20,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            connected: true,
            connectionTimeMs: 15,
            pingSuccess: true,
            role: "master",
          },
        },
      ];

      const aggregated = strategy.aggregateResult(runs);

      expect(aggregated.avgConnectionTime).toBe(10);
      expect(aggregated.successRate).toBe(100);
      expect(aggregated.errorCount).toBe(0);
    });

    it("should count errors", () => {
      const strategy = new RedisHealthCheckStrategy();
      const runs = [
        {
          id: "1",
          status: "unhealthy" as const,
          latencyMs: 100,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            connected: false,
            connectionTimeMs: 100,
            pingSuccess: false,
            error: "Connection refused",
          },
        },
      ];

      const aggregated = strategy.aggregateResult(runs);

      expect(aggregated.errorCount).toBe(1);
      expect(aggregated.successRate).toBe(0);
    });
  });
});
