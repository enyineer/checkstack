import { describe, expect, it, mock } from "bun:test";
import { PingCollector, type PingConfig } from "./ping-collector";
import type { PingTransportClient } from "./transport-client";

describe("PingCollector", () => {
  const createMockClient = (
    response: {
      packetsSent?: number;
      packetsReceived?: number;
      packetLoss?: number;
      minLatency?: number;
      avgLatency?: number;
      maxLatency?: number;
      error?: string;
    } = {}
  ): PingTransportClient => ({
    exec: mock(() =>
      Promise.resolve({
        packetsSent: response.packetsSent ?? 3,
        packetsReceived: response.packetsReceived ?? 3,
        packetLoss: response.packetLoss ?? 0,
        minLatency: response.minLatency ?? 10,
        avgLatency: response.avgLatency ?? 15,
        maxLatency: response.maxLatency ?? 20,
        error: response.error,
      })
    ),
  });

  describe("execute", () => {
    it("should execute ping successfully", async () => {
      const collector = new PingCollector();
      const client = createMockClient();

      const result = await collector.execute({
        config: { host: "192.168.1.1", count: 3, timeout: 5000 },
        client,
        pluginId: "test",
      });

      expect(result.result.packetsSent).toBe(3);
      expect(result.result.packetsReceived).toBe(3);
      expect(result.result.packetLoss).toBe(0);
      expect(result.result.avgLatency).toBe(15);
      expect(result.error).toBeUndefined();
    });

    it("should return error for failed ping", async () => {
      const collector = new PingCollector();
      const client = createMockClient({
        packetsSent: 3,
        packetsReceived: 0,
        packetLoss: 100,
        error: "Host unreachable",
      });

      const result = await collector.execute({
        config: { host: "10.255.255.1", count: 3, timeout: 5000 },
        client,
        pluginId: "test",
      });

      expect(result.result.packetLoss).toBe(100);
      expect(result.error).toBe("Host unreachable");
    });

    it("should pass correct parameters to client", async () => {
      const collector = new PingCollector();
      const client = createMockClient();

      await collector.execute({
        config: { host: "8.8.8.8", count: 5, timeout: 3000 },
        client,
        pluginId: "test",
      });

      expect(client.exec).toHaveBeenCalledWith({
        host: "8.8.8.8",
        count: 5,
        timeout: 3000,
      });
    });
  });

  describe("mergeResult", () => {
    it("should calculate average packet loss and latency", () => {
      const collector = new PingCollector();
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
          },
        },
        {
          id: "2",
          status: "healthy" as const,
          latencyMs: 15,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            packetsSent: 3,
            packetsReceived: 3,
            packetLoss: 10,
            avgLatency: 20,
          },
        },
      ];

      let aggregated = collector.mergeResult(undefined, runs[0]);
      aggregated = collector.mergeResult(aggregated, runs[1]);

      expect(aggregated.avgPacketLoss.avg).toBe(5);
      expect(aggregated.avgLatency.avg).toBe(15);
    });
  });

  describe("metadata", () => {
    it("should have correct static properties", () => {
      const collector = new PingCollector();

      expect(collector.id).toBe("ping");
      expect(collector.displayName).toBe("ICMP Ping");
      expect(collector.allowMultiple).toBe(true);
      expect(collector.supportedPlugins).toHaveLength(1);
    });
  });
});
