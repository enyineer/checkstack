import { describe, expect, it, spyOn, afterEach } from "bun:test";
import { JenkinsHealthCheckStrategy } from "./strategy";

describe("JenkinsHealthCheckStrategy", () => {
  const strategy = new JenkinsHealthCheckStrategy();

  afterEach(() => {
    spyOn(globalThis, "fetch").mockRestore();
  });

  describe("createClient", () => {
    it("should return a connected client with exec function", async () => {
      const connectedClient = await strategy.createClient({
        baseUrl: "https://jenkins.example.com",
        username: "admin",
        apiToken: "api-token-123",
        timeout: 5000,
      });

      expect(connectedClient.client).toBeDefined();
      expect(connectedClient.client.exec).toBeDefined();
      expect(connectedClient.close).toBeDefined();
    });

    it("should allow closing the client without error", async () => {
      const connectedClient = await strategy.createClient({
        baseUrl: "https://jenkins.example.com",
        username: "admin",
        apiToken: "api-token-123",
        timeout: 5000,
      });

      expect(() => connectedClient.close()).not.toThrow();
    });
  });

  describe("client.exec", () => {
    it("should return successful response for valid request", async () => {
      spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ mode: "NORMAL", numExecutors: 2 }), {
          status: 200,
          statusText: "OK",
          headers: { "X-Jenkins": "2.426.1" },
        }),
      );

      const connectedClient = await strategy.createClient({
        baseUrl: "https://jenkins.example.com",
        username: "admin",
        apiToken: "api-token-123",
        timeout: 5000,
      });

      const result = await connectedClient.client.exec({
        path: "/api/json",
      });

      expect(result.statusCode).toBe(200);
      expect(result.error).toBeUndefined();
      expect(result.jenkinsVersion).toBe("2.426.1");
      expect(result.data).toEqual({ mode: "NORMAL", numExecutors: 2 });

      connectedClient.close();
    });

    it("should include query parameters in request", async () => {
      let capturedUrl = "";
      spyOn(globalThis, "fetch").mockImplementation((async (
        url: RequestInfo | URL,
      ) => {
        capturedUrl = url.toString();
        return new Response(JSON.stringify({}), { status: 200 });
      }) as unknown as typeof fetch);

      const connectedClient = await strategy.createClient({
        baseUrl: "https://jenkins.example.com",
        username: "admin",
        apiToken: "api-token-123",
        timeout: 5000,
      });

      await connectedClient.client.exec({
        path: "/api/json",
        query: { tree: "jobs[name,color]" },
      });

      expect(capturedUrl).toContain("/api/json?");
      expect(capturedUrl).toContain("tree=jobs%5Bname%2Ccolor%5D");

      connectedClient.close();
    });

    it("should send Basic Auth header", async () => {
      let capturedHeaders: Record<string, string> | undefined;
      spyOn(globalThis, "fetch").mockImplementation((async (
        _url: RequestInfo | URL,
        options?: RequestInit,
      ) => {
        capturedHeaders = options?.headers as Record<string, string>;
        return new Response(JSON.stringify({}), { status: 200 });
      }) as unknown as typeof fetch);

      const connectedClient = await strategy.createClient({
        baseUrl: "https://jenkins.example.com",
        username: "admin",
        apiToken: "api-token-123",
        timeout: 5000,
      });

      await connectedClient.client.exec({ path: "/api/json" });

      expect(capturedHeaders?.["Authorization"]).toContain("Basic ");
      const decoded = Buffer.from(
        capturedHeaders?.["Authorization"]?.replace("Basic ", "") || "",
        "base64",
      ).toString();
      expect(decoded).toBe("admin:api-token-123");

      connectedClient.close();
    });

    it("should return error for HTTP error response", async () => {
      spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(null, { status: 401, statusText: "Unauthorized" }),
      );

      const connectedClient = await strategy.createClient({
        baseUrl: "https://jenkins.example.com",
        username: "admin",
        apiToken: "wrong-token",
        timeout: 5000,
      });

      const result = await connectedClient.client.exec({ path: "/api/json" });

      expect(result.statusCode).toBe(401);
      expect(result.error).toBe("HTTP 401: Unauthorized");
      expect(result.data).toBeUndefined();

      connectedClient.close();
    });

    it("should return error for network failure", async () => {
      spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));

      const connectedClient = await strategy.createClient({
        baseUrl: "https://jenkins.example.com",
        username: "admin",
        apiToken: "api-token-123",
        timeout: 5000,
      });

      const result = await connectedClient.client.exec({ path: "/api/json" });

      expect(result.statusCode).toBe(0);
      expect(result.error).toBe("Network error");
      expect(result.data).toBeUndefined();

      connectedClient.close();
    });
  });

  describe("mergeResult", () => {
    it("should calculate success rate from runs", () => {
      const runs: Parameters<typeof strategy.mergeResult>[1][] = [
        {
          status: "healthy" as const,
          latencyMs: 100,
          metadata: { connected: true, responseTimeMs: 150 },
        },
        {
          status: "healthy" as const,
          latencyMs: 200,
          metadata: { connected: true, responseTimeMs: 200 },
        },
        {
          status: "unhealthy" as const,
          latencyMs: 50,
          metadata: { connected: false, error: "Connection failed" },
        },
      ];

      let aggregated = strategy.mergeResult(undefined, runs[0]);
      aggregated = strategy.mergeResult(aggregated, runs[1]);
      aggregated = strategy.mergeResult(aggregated, runs[2]);

      expect(aggregated.successRate.rate).toBe(67); // 2/3
      expect(aggregated.avgResponseTimeMs.avg).toBe(175); // (150+200)/2
      expect(aggregated.errorCount.count).toBe(1);
    });

    it("should handle single run", () => {
      const run = {
        status: "healthy" as const,
        latencyMs: 100,
        metadata: { connected: true, responseTimeMs: 150 },
      };
      const aggregated = strategy.mergeResult(undefined, run);

      expect(aggregated.successRate.rate).toBe(100);
      expect(aggregated.avgResponseTimeMs.avg).toBe(150);
      expect(aggregated.errorCount.count).toBe(0);
    });
  });
});
