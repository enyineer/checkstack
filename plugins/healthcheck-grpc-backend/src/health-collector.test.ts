import { describe, expect, it, mock } from "bun:test";
import { evaluateAssertions } from "@checkstack/backend-api";
import { HealthCollector, type HealthConfig } from "./health-collector";
import type {
  GrpcTransportClient,
  GrpcHealthResponse,
} from "./transport-client";

describe("HealthCollector", () => {
  const createMockClient = (
    response: Partial<GrpcHealthResponse> = {},
  ): GrpcTransportClient => ({
    exec: mock(() =>
      Promise.resolve({
        status: response.status ?? "SERVING",
        error: response.error,
      }),
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

    // Regression: a completed health RPC that answers NOT_SERVING is a
    // SUCCESSFUL collection - the server was reached and responded. The
    // collector must NOT set `error` (the executor treats that as a transport
    // failure). `serving` / `status` are assertable metrics. Previously this
    // asserted the wrong behavior (`error` contains "NOT_SERVING").
    it("does not hard-fail the collector on a NOT_SERVING status", async () => {
      const collector = new HealthCollector();
      const client = createMockClient({ status: "NOT_SERVING" });

      const result = await collector.execute({
        config: { service: "myservice" },
        client,
        pluginId: "test",
      });

      expect(result.result.status).toBe("NOT_SERVING");
      expect(result.result.serving).toBe(false);
      expect(result.error).toBeUndefined();

      // A "serving is true" assertion fails - the user decides this is
      // unhealthy, not the collector.
      const failed = evaluateAssertions(
        [{ field: "serving", operator: "isTrue" }],
        result.result as Record<string, unknown>,
      );
      expect(failed).not.toBeNull();

      // A check that WANTS NOT_SERVING (e.g. asserting a service is drained)
      // can be green.
      const failedWanted = evaluateAssertions(
        [{ field: "status", operator: "equals", value: "NOT_SERVING" }],
        result.result as Record<string, unknown>,
      );
      expect(failedWanted).toBeNull();
    });

    // A genuine transport failure (the RPC could not complete) IS a collector
    // failure: the transport client surfaces it via `response.error` and the
    // collector forwards it.
    it("forwards a real transport error from the RPC client", async () => {
      const collector = new HealthCollector();
      const client = createMockClient({
        status: "UNKNOWN",
        error: "14 UNAVAILABLE: connection refused",
      });

      const result = await collector.execute({
        config: { service: "" },
        client,
        pluginId: "test",
      });

      expect(result.error).toContain("UNAVAILABLE");
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

  describe("mergeResult", () => {
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

      let aggregated = collector.mergeResult(undefined, runs[0]);
      aggregated = collector.mergeResult(aggregated, runs[1]);

      expect(aggregated.avgResponseTimeMs.avg).toBe(75);
      expect(aggregated.servingRate.rate).toBe(100);
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

      let aggregated = collector.mergeResult(undefined, runs[0]);
      aggregated = collector.mergeResult(aggregated, runs[1]);

      expect(aggregated.servingRate.rate).toBe(50);
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
