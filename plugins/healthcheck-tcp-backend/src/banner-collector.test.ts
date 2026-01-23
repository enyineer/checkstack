import { describe, expect, it, mock } from "bun:test";
import { BannerCollector, type BannerConfig } from "./banner-collector";
import type { TcpTransportClient } from "./transport-client";

describe("BannerCollector", () => {
  const createMockClient = (
    response: {
      banner?: string;
      connected?: boolean;
      error?: string;
    } = {}
  ): TcpTransportClient => ({
    exec: mock(() =>
      Promise.resolve({
        banner: response.banner,
        connected: response.connected ?? true,
        error: response.error,
      })
    ),
  });

  describe("execute", () => {
    it("should read banner successfully", async () => {
      const collector = new BannerCollector();
      const client = createMockClient({ banner: "SSH-2.0-OpenSSH_8.9" });

      const result = await collector.execute({
        config: { timeout: 5000 },
        client,
        pluginId: "test",
      });

      expect(result.result.banner).toBe("SSH-2.0-OpenSSH_8.9");
      expect(result.result.hasBanner).toBe(true);
      expect(result.result.readTimeMs).toBeGreaterThanOrEqual(0);
    });

    it("should return hasBanner false when no banner", async () => {
      const collector = new BannerCollector();
      const client = createMockClient({ banner: undefined });

      const result = await collector.execute({
        config: { timeout: 5000 },
        client,
        pluginId: "test",
      });

      expect(result.result.hasBanner).toBe(false);
    });

    it("should pass correct parameters to client", async () => {
      const collector = new BannerCollector();
      const client = createMockClient();

      await collector.execute({
        config: { timeout: 3000 },
        client,
        pluginId: "test",
      });

      expect(client.exec).toHaveBeenCalledWith({
        type: "read",
        timeout: 3000,
      });
    });
  });

  describe("mergeResult", () => {
    it("should calculate average read time and banner rate", () => {
      const collector = new BannerCollector();
      const runs = [
        {
          id: "1",
          status: "healthy" as const,
          latencyMs: 10,
          checkId: "c1",
          timestamp: new Date(),
          metadata: { banner: "SSH-2.0", hasBanner: true, readTimeMs: 50 },
        },
        {
          id: "2",
          status: "healthy" as const,
          latencyMs: 15,
          checkId: "c1",
          timestamp: new Date(),
          metadata: { hasBanner: false, readTimeMs: 100 },
        },
      ];

      let aggregated = collector.mergeResult(undefined, runs[0]);
      aggregated = collector.mergeResult(aggregated, runs[1]);

      expect(aggregated.avgReadTimeMs.avg).toBe(75);
      expect(aggregated.bannerRate.rate).toBe(50);
    });
  });

  describe("metadata", () => {
    it("should have correct static properties", () => {
      const collector = new BannerCollector();

      expect(collector.id).toBe("banner");
      expect(collector.displayName).toBe("TCP Banner");
      expect(collector.allowMultiple).toBe(false);
      expect(collector.supportedPlugins).toHaveLength(1);
    });
  });
});
