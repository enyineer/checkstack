import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import { PingHealthCheckStrategy } from "./strategy";

// Mock Bun.spawn for testing
const mockSpawn = mock(() => ({
  stdout: new ReadableStream({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          `PING 8.8.8.8 (8.8.8.8): 56 data bytes
64 bytes from 8.8.8.8: icmp_seq=0 ttl=118 time=10.123 ms
64 bytes from 8.8.8.8: icmp_seq=1 ttl=118 time=12.456 ms
64 bytes from 8.8.8.8: icmp_seq=2 ttl=118 time=11.789 ms

--- 8.8.8.8 ping statistics ---
3 packets transmitted, 3 packets received, 0.0% packet loss
round-trip min/avg/max/stddev = 10.123/11.456/12.456/0.957 ms`,
        ),
      );
      controller.close();
    },
  }),
  stderr: new ReadableStream(),
  exited: Promise.resolve(0),
}));

describe("PingHealthCheckStrategy", () => {
  let strategy: PingHealthCheckStrategy;
  const originalSpawn = Bun.spawn;

  beforeEach(() => {
    strategy = new PingHealthCheckStrategy();
    mockSpawn.mockClear();
    // @ts-expect-error - mocking global
    Bun.spawn = mockSpawn;
  });

  afterEach(() => {
    Bun.spawn = originalSpawn;
  });

  describe("createClient", () => {
    it("should return a connected client", async () => {
      const connectedClient = await strategy.createClient({ timeout: 5000 });

      expect(connectedClient.client).toBeDefined();
      expect(connectedClient.client.exec).toBeDefined();
      expect(connectedClient.close).toBeDefined();
    });

    it("should allow closing the client", async () => {
      const connectedClient = await strategy.createClient({ timeout: 5000 });

      // Close should not throw
      expect(() => connectedClient.close()).not.toThrow();
    });
  });

  describe("client.exec", () => {
    it("should return healthy result for successful ping", async () => {
      const connectedClient = await strategy.createClient({ timeout: 5000 });
      const result = await connectedClient.client.exec({
        host: "8.8.8.8",
        count: 3,
        timeout: 5000,
      });

      expect(result.packetsSent).toBe(3);
      expect(result.packetsReceived).toBe(3);
      expect(result.packetLoss).toBe(0);
      expect(result.avgLatency).toBeCloseTo(11.456, 2);

      connectedClient.close();
    });

    it("should return unhealthy result for 100% packet loss", async () => {
      // @ts-expect-error - mocking global
      Bun.spawn = mock(() => ({
        stdout: new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                `PING 10.0.0.1 (10.0.0.1): 56 data bytes

--- 10.0.0.1 ping statistics ---
3 packets transmitted, 0 packets received, 100.0% packet loss`,
              ),
            );
            controller.close();
          },
        }),
        stderr: new ReadableStream(),
        exited: Promise.resolve(1),
      }));

      const connectedClient = await strategy.createClient({ timeout: 5000 });
      const result = await connectedClient.client.exec({
        host: "10.0.0.1",
        count: 3,
        timeout: 5000,
      });

      expect(result.packetLoss).toBe(100);
      expect(result.error).toContain("unreachable");

      connectedClient.close();
    });

    it("should handle spawn errors gracefully", async () => {
      Bun.spawn = mock(() => {
        throw new Error("Command not found");
      }) as typeof Bun.spawn;

      const connectedClient = await strategy.createClient({ timeout: 5000 });
      const result = await connectedClient.client.exec({
        host: "8.8.8.8",
        count: 3,
        timeout: 5000,
      });

      expect(result.error).toBeDefined();

      connectedClient.close();
    });

    it("should use strategy timeout as fallback", async () => {
      const connectedClient = await strategy.createClient({ timeout: 5000 });

      // The exec should work without timeout specified in request
      const result = await connectedClient.client.exec({
        host: "8.8.8.8",
        count: 3,
        timeout: 30_000,
      });

      expect(result.packetsSent).toBe(3);

      connectedClient.close();
    });
  });

  describe("mergeResult", () => {
    it("should calculate averages correctly", () => {
      const runs = [
        {
          id: "1",
          status: "healthy" as const,
          latencyMs: 10,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            packetsSent: 3,
            packetsReceived: 3,
            packetLoss: 0,
            avgLatency: 10,
            maxLatency: 15,
          },
        },
        {
          id: "2",
          status: "healthy" as const,
          latencyMs: 20,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            packetsSent: 3,
            packetsReceived: 2,
            packetLoss: 33,
            avgLatency: 20,
            maxLatency: 25,
          },
        },
      ];

      let aggregated = strategy.mergeResult(undefined, runs[0]);
      aggregated = strategy.mergeResult(aggregated, runs[1]);

      // (0 + 33) / 2 = 16.5
      expect(aggregated.avgPacketLoss.avg).toBeCloseTo(16.5, 1);
      expect(aggregated.avgLatency.avg).toBeCloseTo(15, 1);
      expect(aggregated.maxLatency.max).toBe(25);
      expect(aggregated.errorCount.count).toBe(0);
    });

    it("should count errors", () => {
      const run = {
        id: "1",
        status: "unhealthy" as const,
        latencyMs: 0,
        checkId: "c1",
        timestamp: new Date(),
        metadata: {
          packetsSent: 3,
          packetsReceived: 0,
          packetLoss: 100,
          error: "Timeout",
        },
      };

      const aggregated = strategy.mergeResult(undefined, run);

      expect(aggregated.errorCount.count).toBe(1);
    });
  });
});
