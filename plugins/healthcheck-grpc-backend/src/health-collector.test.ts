import { describe, expect, it, mock } from "bun:test";
import { HealthCollector, type HealthConfig } from "./health-collector";
import type {
  GrpcTransportClient,
  GrpcHealthResponse,
} from "./transport-client";

describe("HealthCollector", () => {
  const createMockClient = (
    response: Partial<GrpcHealthResponse> = {}
  ): GrpcTransportClient => ({
    exec: mock(() =>
      Promise.resolve({
        status: response.status ?? "SERVING",
        error: response.error,
      })
    ),
  });

  describe("execute", () => {
    it("should check health status successfully", async () => {
      const collector = new HealthCollector();
      const client = createMockClient({ status: "SERVING" });

      const result = await collector.execute({
        config: { service: "" },
        client,
        pluginId: "test",
      });

      expect(result.result.status).toBe("SERVING");
      expect(result.result.serving).toBe(true);
      expect(result.result.responseTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
    });

    it("should return error for NOT_SERVING status", async () => {
      const collector = new HealthCollector();
      const client = createMockClient({ status: "NOT_SERVING" });

      const result = await collector.execute({
        config: { service: "myservice" },
        client,
        pluginId: "test",
      });

      expect(result.result.status).toBe("NOT_SERVING");
      expect(result.result.serving).toBe(false);
      expect(result.error).toContain("NOT_SERVING");
    });

    it("should pass service name to client", async () => {
      const collector = new HealthCollector();
      const client = createMockClient();

      await collector.execute({
        config: { service: "my.grpc.Service" },
        client,
        pluginId: "test",
      });

      expect(client.exec).toHaveBeenCalledWith({
        service: "my.grpc.Service",
      });
    });
  });

  describe("aggregateResult", () => {
    it("should calculate average response time and serving rate", () => {
      const collector = new HealthCollector();
      const runs = [
        {
          id: "1",
          status: "healthy" as const,
          latencyMs: 10,
          checkId: "c1",
          timestamp: new Date(),
          metadata: { status: "SERVING", serving: true, responseTimeMs: 50 },
        },
        {
          id: "2",
          status: "healthy" as const,
          latencyMs: 15,
          checkId: "c1",
          timestamp: new Date(),
          metadata: { status: "SERVING", serving: true, responseTimeMs: 100 },
        },
      ];

      const aggregated = collector.aggregateResult(runs);

      expect(aggregated.avgResponseTimeMs).toBe(75);
      expect(aggregated.servingRate).toBe(100);
    });

    it("should calculate serving rate correctly", () => {
      const collector = new HealthCollector();
      const runs = [
        {
          id: "1",
          status: "healthy" as const,
          latencyMs: 10,
          checkId: "c1",
          timestamp: new Date(),
          metadata: { status: "SERVING", serving: true, responseTimeMs: 50 },
        },
        {
          id: "2",
          status: "unhealthy" as const,
          latencyMs: 15,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            status: "NOT_SERVING",
            serving: false,
            responseTimeMs: 100,
          },
        },
      ];

      const aggregated = collector.aggregateResult(runs);

      expect(aggregated.servingRate).toBe(50);
    });
  });

  describe("metadata", () => {
    it("should have correct static properties", () => {
      const collector = new HealthCollector();

      expect(collector.id).toBe("health");
      expect(collector.displayName).toBe("gRPC Health Check");
      expect(collector.allowMultiple).toBe(true);
      expect(collector.supportedPlugins).toHaveLength(1);
    });
  });
});
