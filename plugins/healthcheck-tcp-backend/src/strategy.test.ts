import { describe, expect, it, mock } from "bun:test";
import { TcpHealthCheckStrategy, TcpSocket, SocketFactory } from "./strategy";

describe("TcpHealthCheckStrategy", () => {
  // Helper to create mock socket factory
  const createMockSocket = (
    config: {
      connectError?: Error;
      banner?: string;
    } = {},
  ): SocketFactory => {
    return () =>
      ({
        connect: mock(() =>
          config.connectError
            ? Promise.reject(config.connectError)
            : Promise.resolve(),
        ),
        read: mock(() => Promise.resolve(config.banner ?? null)),
        close: mock(() => {}),
      }) as TcpSocket;
  };

  describe("createClient", () => {
    it("should return a connected client for successful connection", async () => {
      const strategy = new TcpHealthCheckStrategy(createMockSocket());

      const connectedClient = await strategy.createClient({
        host: "localhost",
        port: 80,
        timeout: 5000,
      });

      expect(connectedClient.client).toBeDefined();
      expect(connectedClient.client.exec).toBeDefined();
      expect(connectedClient.close).toBeDefined();

      connectedClient.close();
    });

    it("should throw for connection error", async () => {
      const strategy = new TcpHealthCheckStrategy(
        createMockSocket({ connectError: new Error("Connection refused") }),
      );

      await expect(
        strategy.createClient({
          host: "localhost",
          port: 12345,
          timeout: 5000,
        }),
      ).rejects.toThrow("Connection refused");
    });
  });

  describe("client.exec", () => {
    it("should return connected status for connect action", async () => {
      const strategy = new TcpHealthCheckStrategy(createMockSocket());
      const connectedClient = await strategy.createClient({
        host: "localhost",
        port: 80,
        timeout: 5000,
      });

      const result = await connectedClient.client.exec({ type: "connect" });

      expect(result.connected).toBe(true);

      connectedClient.close();
    });

    it("should read banner with read action", async () => {
      const strategy = new TcpHealthCheckStrategy(
        createMockSocket({ banner: "SSH-2.0-OpenSSH" }),
      );
      const connectedClient = await strategy.createClient({
        host: "localhost",
        port: 22,
        timeout: 5000,
      });

      const result = await connectedClient.client.exec({
        type: "read",
        timeout: 1000,
      });

      expect(result.banner).toBe("SSH-2.0-OpenSSH");

      connectedClient.close();
    });
  });

  describe("mergeResult", () => {
    it("should calculate averages correctly", () => {
      const strategy = new TcpHealthCheckStrategy();
      const runs = [
        {
          id: "1",
          status: "healthy" as const,
          latencyMs: 10,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            connected: true,
            connectionTimeMs: 10,
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
            connectionTimeMs: 20,
          },
        },
      ];

      let aggregated = strategy.mergeResult(undefined, runs[0]);
      aggregated = strategy.mergeResult(aggregated, runs[1]);

      expect(aggregated.avgConnectionTime.avg).toBe(15);
      expect(aggregated.successRate.rate).toBe(100);
      expect(aggregated.errorCount.count).toBe(0);
    });

    it("should count errors and calculate success rate", () => {
      const strategy = new TcpHealthCheckStrategy();
      const runs = [
        {
          id: "1",
          status: "healthy" as const,
          latencyMs: 10,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            connected: true,
            connectionTimeMs: 10,
          },
        },
        {
          id: "2",
          status: "unhealthy" as const,
          latencyMs: 0,
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
  });

  describe("config migration (assume-v1-on-read)", () => {
    const strategy = new TcpHealthCheckStrategy();

    it("migrates a genuine v1 blob (readBanner present) to {host, port, timeout}", async () => {
      const migrated = await strategy.config.parseAssumingV1({
        host: "example.com",
        port: 443,
        timeout: 5000,
        readBanner: true,
      });
      expect(migrated).toEqual({ host: "example.com", port: 443, timeout: 5000 });
    });

    it("is idempotent: an already-current {host, port, timeout} blob is unchanged", async () => {
      const migrated = await strategy.config.parseAssumingV1({
        host: "db.internal",
        port: 5432,
        timeout: 3000,
      });
      expect(migrated).toEqual({ host: "db.internal", port: 5432, timeout: 3000 });
    });

    it("passes through a v1 row that omitted readBanner (already v2-shaped)", async () => {
      // A v1 config that never carried readBanner already matches the v2 shape,
      // so the guard correctly treats it as a no-op passthrough.
      const migrated = await strategy.config.parseAssumingV1({
        host: "host.local",
        port: 22,
        timeout: 2000,
      });
      expect(migrated).toEqual({ host: "host.local", port: 22, timeout: 2000 });
    });

    it("has a complete v1->version migration chain", () => {
      expect(strategy.config.validateMigrationChainFromV1()).toBeUndefined();
    });
  });
});
