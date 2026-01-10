import { describe, expect, it, mock } from "bun:test";
import { RequestCollector, type RequestConfig } from "./request-collector";
import type { HttpTransportClient } from "./transport-client";

describe("RequestCollector", () => {
  const createMockClient = (
    response: {
      statusCode?: number;
      statusText?: string;
      body?: string;
    } = {}
  ): HttpTransportClient => ({
    exec: mock(() =>
      Promise.resolve({
        statusCode: response.statusCode ?? 200,
        statusText: response.statusText ?? "OK",
        headers: {},
        body: response.body ?? "",
      })
    ),
  });

  describe("execute", () => {
    it("should execute HTTP request successfully", async () => {
      const collector = new RequestCollector();
      const client = createMockClient({
        statusCode: 200,
        statusText: "OK",
        body: "Hello World",
      });

      const result = await collector.execute({
        config: { url: "https://example.com", method: "GET", timeout: 5000 },
        client,
        pluginId: "test",
      });

      expect(result.result.statusCode).toBe(200);
      expect(result.result.statusText).toBe("OK");
      expect(result.result.success).toBe(true);
      expect(result.result.bodyLength).toBe(11);
      expect(result.result.responseTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
    });

    it("should return error for failed requests", async () => {
      const collector = new RequestCollector();
      const client = createMockClient({
        statusCode: 500,
        statusText: "Internal Server Error",
      });

      const result = await collector.execute({
        config: {
          url: "https://example.com/error",
          method: "GET",
          timeout: 5000,
        },
        client,
        pluginId: "test",
      });

      expect(result.result.statusCode).toBe(500);
      expect(result.result.success).toBe(false);
      expect(result.error).toContain("500");
    });

    it("should convert headers array to record", async () => {
      const collector = new RequestCollector();
      const client = createMockClient();

      await collector.execute({
        config: {
          url: "https://example.com",
          method: "POST",
          timeout: 5000,
          headers: [
            { name: "Content-Type", value: "application/json" },
            { name: "Authorization", value: "Bearer token" },
          ],
        },
        client,
        pluginId: "test",
      });

      expect(client.exec).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer token",
          },
        })
      );
    });

    it("should pass body to client", async () => {
      const collector = new RequestCollector();
      const client = createMockClient();

      await collector.execute({
        config: {
          url: "https://example.com",
          method: "POST",
          timeout: 5000,
          body: '{"key":"value"}',
        },
        client,
        pluginId: "test",
      });

      expect(client.exec).toHaveBeenCalledWith(
        expect.objectContaining({
          body: '{"key":"value"}',
        })
      );
    });
  });

  describe("aggregateResult", () => {
    it("should calculate average response time", () => {
      const collector = new RequestCollector();
      const runs = [
        {
          id: "1",
          status: "healthy" as const,
          latencyMs: 100,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            statusCode: 200,
            statusText: "OK",
            responseTimeMs: 50,
            body: "",
            bodyLength: 100,
            success: true,
          },
        },
        {
          id: "2",
          status: "healthy" as const,
          latencyMs: 150,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            statusCode: 200,
            statusText: "OK",
            responseTimeMs: 100,
            body: "",
            bodyLength: 200,
            success: true,
          },
        },
      ];

      const aggregated = collector.aggregateResult(runs);

      expect(aggregated.avgResponseTimeMs).toBe(75);
      expect(aggregated.successRate).toBe(100);
    });

    it("should calculate success rate correctly", () => {
      const collector = new RequestCollector();
      const runs = [
        {
          id: "1",
          status: "healthy" as const,
          latencyMs: 100,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            statusCode: 200,
            statusText: "OK",
            responseTimeMs: 50,
            body: "",
            bodyLength: 100,
            success: true,
          },
        },
        {
          id: "2",
          status: "unhealthy" as const,
          latencyMs: 150,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            statusCode: 500,
            statusText: "Error",
            responseTimeMs: 100,
            body: "",
            bodyLength: 0,
            success: false,
          },
        },
      ];

      const aggregated = collector.aggregateResult(runs);

      expect(aggregated.successRate).toBe(50);
    });
  });

  describe("metadata", () => {
    it("should have correct static properties", () => {
      const collector = new RequestCollector();

      expect(collector.id).toBe("request");
      expect(collector.displayName).toBe("HTTP Request");
      expect(collector.allowMultiple).toBe(true);
      expect(collector.supportedPlugins).toHaveLength(1);
    });
  });
});
