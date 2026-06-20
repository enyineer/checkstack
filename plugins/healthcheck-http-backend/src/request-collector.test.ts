import { describe, expect, it, mock } from "bun:test";
import { evaluateAssertions } from "@checkstack/backend-api";
import { RequestCollector, type RequestConfig } from "./request-collector";
import type { HttpTransportClient } from "./transport-client";

describe("RequestCollector", () => {
  const createMockClient = (
    response: {
      statusCode?: number;
      statusText?: string;
      body?: string;
    } = {},
  ): HttpTransportClient => ({
    exec: mock(() =>
      Promise.resolve({
        statusCode: response.statusCode ?? 200,
        statusText: response.statusText ?? "OK",
        headers: {},
        body: response.body ?? "",
      }),
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

    // Regression: a received-but-non-2xx response (e.g. 500) is a SUCCESSFUL
    // collection - the server was reached and answered. The collector must NOT
    // set the `error` field (which the executor treats as a transport failure
    // and uses to hard-fail the run). It records the status code as a metric
    // and lets assertions decide health. Previously this asserted the wrong
    // behavior (`error` contains "500"); updated to the corrected semantics.
    it("does not hard-fail the collector on a 5xx response", async () => {
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
      // `success` stays a metric (2xx/3xx => true); 500 => false.
      expect(result.result.success).toBe(false);
      // The collector reports transport success: no error field is set.
      expect(result.error).toBeUndefined();
    });

    // Regression: a 404 is a fully successful HTTP transaction. The collector
    // must report transport success (no `error`) and expose the status code as
    // a metric so a "statusCode equals 404" assertion can pass (GREEN), and so
    // a check with no assertions is not auto-failed by the collector.
    it("treats a 404 as a successful collection with the status as a metric", async () => {
      const collector = new RequestCollector();
      const client = createMockClient({
        statusCode: 404,
        statusText: "Not Found",
      });

      const result = await collector.execute({
        config: {
          url: "https://example.com/missing",
          method: "GET",
          timeout: 5000,
        },
        client,
        pluginId: "test",
      });

      expect(result.result.statusCode).toBe(404);
      expect(result.error).toBeUndefined();

      // A "status code equals 404" assertion passes against the result, so a
      // check that WANTS a 404 can be green.
      const failed = evaluateAssertions(
        [{ field: "statusCode", operator: "equals", value: 404 }],
        result.result as Record<string, unknown>,
      );
      expect(failed).toBeNull();

      // A "status code equals 200" assertion fails - the user, not the
      // collector, decides this is unhealthy.
      const failed200 = evaluateAssertions(
        [{ field: "statusCode", operator: "equals", value: 200 }],
        result.result as Record<string, unknown>,
      );
      expect(failed200).not.toBeNull();
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
        }),
      );
    });

    it("returns a clear config error when the rendered URL is invalid", async () => {
      // The executor renders `{{ environment.* }}` into `config.url` before
      // execute. An empty environment can produce a non-URL (e.g. "/healthz"
      // when baseUrl is missing). The collector must surface this as a clear
      // config error, not attempt the request.
      const collector = new RequestCollector();
      const client = createMockClient();

      const result = await collector.execute({
        config: { url: "/healthz", method: "GET", timeout: 5000 },
        client,
        pluginId: "test",
      });

      expect(result.result.success).toBe(false);
      expect(result.result.statusCode).toBe(0);
      expect(result.error).toContain("Rendered URL is invalid");
      expect(client.exec).not.toHaveBeenCalled();
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
        }),
      );
    });
  });

  describe("mergeResult", () => {
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

      // Merge runs incrementally
      let aggregated = collector.mergeResult(undefined, runs[0]);
      aggregated = collector.mergeResult(aggregated, runs[1]);

      expect(aggregated.avgResponseTimeMs.avg).toBe(75);
      expect(aggregated.successRate.rate).toBe(100);
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

      // Merge runs incrementally
      let aggregated = collector.mergeResult(undefined, runs[0]);
      aggregated = collector.mergeResult(aggregated, runs[1]);

      expect(aggregated.successRate.rate).toBe(50);
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
