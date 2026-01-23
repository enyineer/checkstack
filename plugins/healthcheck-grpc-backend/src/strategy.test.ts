import { describe, expect, it, mock } from "bun:test";
import {
  GrpcHealthCheckStrategy,
  GrpcHealthClient,
  GrpcHealthStatusType,
} from "./strategy";

describe("GrpcHealthCheckStrategy", () => {
  // Helper to create mock gRPC client
  const createMockClient = (
    config: {
      status?: GrpcHealthStatusType;
      error?: Error;
    } = {}
  ): GrpcHealthClient => ({
    check: mock(() =>
      config.error
        ? Promise.reject(config.error)
        : Promise.resolve({ status: config.status ?? "SERVING" })
    ),
  });

  describe("createClient", () => {
    it("should return a connected client", async () => {
      const strategy = new GrpcHealthCheckStrategy(createMockClient());

      const connectedClient = await strategy.createClient({
        host: "localhost",
        port: 50051,
        timeout: 5000,
      });

      expect(connectedClient.client).toBeDefined();
      expect(connectedClient.client.exec).toBeDefined();
      expect(connectedClient.close).toBeDefined();

      connectedClient.close();
    });
  });

  describe("client.exec (health check action)", () => {
    it("should return SERVING status for healthy service", async () => {
      const strategy = new GrpcHealthCheckStrategy(createMockClient());

      const connectedClient = await strategy.createClient({
        host: "localhost",
        port: 50051,
        timeout: 5000,
      });

      const result = await connectedClient.client.exec({ service: "" });

      expect(result.status).toBe("SERVING");

      connectedClient.close();
    });

    it("should return NOT_SERVING status for unhealthy service", async () => {
      const strategy = new GrpcHealthCheckStrategy(
        createMockClient({ status: "NOT_SERVING" })
      );

      const connectedClient = await strategy.createClient({
        host: "localhost",
        port: 50051,
        timeout: 5000,
      });

      const result = await connectedClient.client.exec({ service: "" });

      expect(result.status).toBe("NOT_SERVING");

      connectedClient.close();
    });

    it("should return error for connection failure", async () => {
      const strategy = new GrpcHealthCheckStrategy(
        createMockClient({ error: new Error("Connection refused") })
      );

      const connectedClient = await strategy.createClient({
        host: "localhost",
        port: 50051,
        timeout: 5000,
      });

      const result = await connectedClient.client.exec({ service: "" });

      expect(result.error).toContain("Connection refused");

      connectedClient.close();
    });

    it("should check specific service", async () => {
      const mockClient = createMockClient();
      const strategy = new GrpcHealthCheckStrategy(mockClient);

      const connectedClient = await strategy.createClient({
        host: "localhost",
        port: 50051,
        timeout: 5000,
      });

      await connectedClient.client.exec({ service: "my.custom.Service" });

      expect(mockClient.check).toHaveBeenCalledWith(
        expect.objectContaining({ service: "my.custom.Service" })
      );

      connectedClient.close();
    });
  });

  describe("mergeResult", () => {
    it("should calculate averages correctly", () => {
      const strategy = new GrpcHealthCheckStrategy();
      const runs = [
        {
          id: "1",
          status: "healthy" as const,
          latencyMs: 10,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            connected: true,
            responseTimeMs: 5,
            status: "SERVING" as const,
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
            responseTimeMs: 15,
            status: "SERVING" as const,
          },
        },
      ];

      let aggregated = strategy.mergeResult(undefined, runs[0]);
      aggregated = strategy.mergeResult(aggregated, runs[1]);

      expect(aggregated.avgResponseTime.avg).toBe(10);
      expect(aggregated.successRate.rate).toBe(100);
      expect(aggregated.servingCount.count).toBe(2);
      expect(aggregated.errorCount.count).toBe(0);
    });

    it("should count errors and non-serving", () => {
      const strategy = new GrpcHealthCheckStrategy();
      const runs = [
        {
          id: "1",
          status: "unhealthy" as const,
          latencyMs: 10,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            connected: true,
            responseTimeMs: 5,
            status: "NOT_SERVING" as const,
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
            responseTimeMs: 0,
            status: "UNKNOWN" as const,
            error: "Connection refused",
          },
        },
      ];

      let aggregated = strategy.mergeResult(undefined, runs[0]);
      aggregated = strategy.mergeResult(aggregated, runs[1]);

      expect(aggregated.errorCount.count).toBe(1);
      expect(aggregated.servingCount.count).toBe(0);
      expect(aggregated.successRate.rate).toBe(0);
    });
  });
});
