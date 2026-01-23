import { describe, expect, it, mock } from "bun:test";
import { LookupCollector, type LookupConfig } from "./lookup-collector";
import type { DnsTransportClient } from "./transport-client";

describe("LookupCollector", () => {
  const createMockClient = (
    response: { values: string[]; error?: string } = {
      values: ["192.168.1.1"],
    },
  ): DnsTransportClient => ({
    exec: mock(() => Promise.resolve(response)),
  });

  describe("execute", () => {
    it("should resolve DNS records successfully", async () => {
      const collector = new LookupCollector();
      const client = createMockClient({
        values: ["192.168.1.1", "192.168.1.2"],
      });

      const result = await collector.execute({
        config: { hostname: "example.com", recordType: "A" },
        client,
        pluginId: "test",
      });

      expect(result.result.values).toEqual(["192.168.1.1", "192.168.1.2"]);
      expect(result.result.recordCount).toBe(2);
      expect(result.result.resolutionTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
    });

    it("should return error for failed lookups", async () => {
      const collector = new LookupCollector();
      const client = createMockClient({ values: [], error: "NXDOMAIN" });

      const result = await collector.execute({
        config: { hostname: "nonexistent.invalid", recordType: "A" },
        client,
        pluginId: "test",
      });

      expect(result.result.recordCount).toBe(0);
      expect(result.error).toBe("NXDOMAIN");
    });

    it("should pass correct parameters to client", async () => {
      const collector = new LookupCollector();
      const client = createMockClient();

      await collector.execute({
        config: { hostname: "example.com", recordType: "MX" },
        client,
        pluginId: "test",
      });

      expect(client.exec).toHaveBeenCalledWith({
        hostname: "example.com",
        recordType: "MX",
      });
    });
  });

  describe("mergeResult", () => {
    it("should calculate average resolution time", () => {
      const collector = new LookupCollector();
      const runs = [
        {
          id: "1",
          status: "healthy" as const,
          latencyMs: 10,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            values: ["1.1.1.1"],
            recordCount: 1,
            resolutionTimeMs: 50,
          },
        },
        {
          id: "2",
          status: "healthy" as const,
          latencyMs: 15,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            values: ["1.1.1.1"],
            recordCount: 1,
            resolutionTimeMs: 100,
          },
        },
      ];

      // Merge runs incrementally
      let aggregated = collector.mergeResult(undefined, runs[0]);
      aggregated = collector.mergeResult(aggregated, runs[1]);

      expect(aggregated.avgResolutionTimeMs.avg).toBe(75);
      expect(aggregated.successRate.rate).toBe(100);
    });

    it("should calculate success rate correctly", () => {
      const collector = new LookupCollector();
      const runs = [
        {
          id: "1",
          status: "healthy" as const,
          latencyMs: 10,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            values: ["1.1.1.1"],
            recordCount: 1,
            resolutionTimeMs: 50,
          },
        },
        {
          id: "2",
          status: "unhealthy" as const,
          latencyMs: 15,
          checkId: "c1",
          timestamp: new Date(),
          metadata: { values: [], recordCount: 0, resolutionTimeMs: 100 },
        },
      ];

      // Merge runs incrementally
      let aggregated = collector.mergeResult(undefined, runs[0]);
      aggregated = collector.mergeResult(aggregated, runs[1]);

      expect(aggregated.successRate.rate).toBe(50);
    });
  });

  describe("metadata", () => {
    it("should have correct static properties", () => {
      const collector = new LookupCollector();

      expect(collector.id).toBe("lookup");
      expect(collector.displayName).toBe("DNS Lookup");
      expect(collector.allowMultiple).toBe(true);
      expect(collector.supportedPlugins).toHaveLength(1);
    });
  });
});
