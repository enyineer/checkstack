import { describe, expect, it, mock } from "bun:test";
import { PostgresHealthCheckStrategy, DbClient } from "./strategy";

describe("PostgresHealthCheckStrategy", () => {
  // Helper to create mock DB client
  const createMockClient = (
    config: {
      rowCount?: number;
      queryError?: Error;
      connectError?: Error;
    } = {},
  ): DbClient => ({
    connect: mock(() =>
      config.connectError
        ? Promise.reject(config.connectError)
        : Promise.resolve({
            query: mock(() =>
              config.queryError
                ? Promise.reject(config.queryError)
                : Promise.resolve({ rowCount: config.rowCount ?? 1 }),
            ),
            end: mock(() => Promise.resolve()),
          }),
    ),
  });

  describe("createClient", () => {
    it("should return a connected client for successful connection", async () => {
      const strategy = new PostgresHealthCheckStrategy(createMockClient());

      const connectedClient = await strategy.createClient({
        host: "localhost",
        port: 5432,
        database: "test",
        user: "postgres",
        password: "secret",
        timeout: 5000,
      });

      expect(connectedClient.client).toBeDefined();
      expect(connectedClient.client.exec).toBeDefined();
      expect(connectedClient.close).toBeDefined();

      connectedClient.close();
    });

    it("should throw for connection error", async () => {
      const strategy = new PostgresHealthCheckStrategy(
        createMockClient({ connectError: new Error("Connection refused") }),
      );

      await expect(
        strategy.createClient({
          host: "localhost",
          port: 5432,
          database: "test",
          user: "postgres",
          password: "secret",
          timeout: 5000,
        }),
      ).rejects.toThrow("Connection refused");
    });
  });

  describe("client.exec", () => {
    it("should execute query successfully", async () => {
      const strategy = new PostgresHealthCheckStrategy(createMockClient());
      const connectedClient = await strategy.createClient({
        host: "localhost",
        port: 5432,
        database: "test",
        user: "postgres",
        password: "secret",
        timeout: 5000,
      });

      const result = await connectedClient.client.exec({
        query: "SELECT 1",
      });

      expect(result.rowCount).toBe(1);

      connectedClient.close();
    });

    it("should return error for query error", async () => {
      const strategy = new PostgresHealthCheckStrategy(
        createMockClient({ queryError: new Error("Syntax error") }),
      );
      const connectedClient = await strategy.createClient({
        host: "localhost",
        port: 5432,
        database: "test",
        user: "postgres",
        password: "secret",
        timeout: 5000,
      });

      const result = await connectedClient.client.exec({
        query: "INVALID SQL",
      });

      expect(result.error).toContain("Syntax error");

      connectedClient.close();
    });

    it("should return custom row count", async () => {
      const strategy = new PostgresHealthCheckStrategy(
        createMockClient({ rowCount: 5 }),
      );
      const connectedClient = await strategy.createClient({
        host: "localhost",
        port: 5432,
        database: "test",
        user: "postgres",
        password: "secret",
        timeout: 5000,
      });

      const result = await connectedClient.client.exec({
        query: "SELECT * FROM users",
      });

      expect(result.rowCount).toBe(5);

      connectedClient.close();
    });
  });

  describe("mergeResult", () => {
    it("should calculate averages correctly through incremental merging", () => {
      const strategy = new PostgresHealthCheckStrategy();
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
            rowCount: 1,
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
            rowCount: 5,
          },
        },
      ];

      // Merge incrementally
      let aggregated = strategy.mergeResult(undefined, runs[0]);
      aggregated = strategy.mergeResult(aggregated, runs[1]);

      expect(aggregated.avgConnectionTime.avg).toBe(75);
      expect(aggregated.successRate.rate).toBe(100);
      expect(aggregated.errorCount.count).toBe(0);
    });

    it("should count errors", () => {
      const strategy = new PostgresHealthCheckStrategy();
      const run = {
        id: "1",
        status: "unhealthy" as const,
        latencyMs: 100,
        checkId: "c1",
        timestamp: new Date(),
        metadata: {
          connected: false,
          connectionTimeMs: 100,
          error: "Connection refused",
        },
      };

      const aggregated = strategy.mergeResult(undefined, run);

      expect(aggregated.errorCount.count).toBe(1);
      expect(aggregated.successRate.rate).toBe(0);
    });
  });
});
