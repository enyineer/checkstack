import { describe, expect, it, spyOn, afterEach } from "bun:test";
import { HttpHealthCheckStrategy } from "./strategy";

describe("HttpHealthCheckStrategy", () => {
  const strategy = new HttpHealthCheckStrategy();

  afterEach(() => {
    spyOn(globalThis, "fetch").mockRestore();
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

      expect(() => connectedClient.close()).not.toThrow();
    });
  });

  describe("client.exec", () => {
    it("should return successful response for valid request", async () => {
      spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          statusText: "OK",
          headers: { "Content-Type": "application/json" },
        }),
      );

      const connectedClient = await strategy.createClient({ timeout: 5000 });
      const result = await connectedClient.client.exec({
        url: "https://example.com/api",
        method: "GET",
        timeout: 5000,
      });

      expect(result.statusCode).toBe(200);
      expect(result.statusText).toBe("OK");
      expect(result.contentType).toContain("application/json");

      connectedClient.close();
    });

    it("should return 404 status for not found", async () => {
      spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(null, { status: 404, statusText: "Not Found" }),
      );

      const connectedClient = await strategy.createClient({ timeout: 5000 });
      const result = await connectedClient.client.exec({
        url: "https://example.com/notfound",
        method: "GET",
        timeout: 5000,
      });

      expect(result.statusCode).toBe(404);

      connectedClient.close();
    });

    it("should send custom headers with request", async () => {
      let capturedHeaders: Record<string, string> | undefined;
      spyOn(globalThis, "fetch").mockImplementation((async (
        _url: RequestInfo | URL,
        options?: RequestInit,
      ) => {
        capturedHeaders = options?.headers as Record<string, string>;
        return new Response(null, { status: 200 });
      }) as unknown as typeof fetch);

      const connectedClient = await strategy.createClient({ timeout: 5000 });
      await connectedClient.client.exec({
        url: "https://example.com/api",
        method: "GET",
        headers: {
          Authorization: "Bearer my-token",
          "X-Custom-Header": "custom-value",
        },
        timeout: 5000,
      });

      expect(capturedHeaders).toBeDefined();
      expect(capturedHeaders?.["Authorization"]).toBe("Bearer my-token");
      expect(capturedHeaders?.["X-Custom-Header"]).toBe("custom-value");

      connectedClient.close();
    });

    it("should return JSON body as string", async () => {
      const responseBody = { foo: "bar", count: 42 };
      spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(responseBody), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const connectedClient = await strategy.createClient({ timeout: 5000 });
      const result = await connectedClient.client.exec({
        url: "https://example.com/api",
        method: "GET",
        timeout: 5000,
      });

      expect(result.body).toBe(JSON.stringify(responseBody));

      connectedClient.close();
    });

    it("should handle text body", async () => {
      spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("Hello World", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        }),
      );

      const connectedClient = await strategy.createClient({ timeout: 5000 });
      const result = await connectedClient.client.exec({
        url: "https://example.com/api",
        method: "GET",
        timeout: 5000,
      });

      expect(result.body).toBe("Hello World");

      connectedClient.close();
    });

    it("should send POST body", async () => {
      let capturedBody: string | undefined;
      spyOn(globalThis, "fetch").mockImplementation((async (
        _url: RequestInfo | URL,
        options?: RequestInit,
      ) => {
        capturedBody = options?.body as string;
        return new Response(null, { status: 201 });
      }) as unknown as typeof fetch);

      const connectedClient = await strategy.createClient({ timeout: 5000 });
      await connectedClient.client.exec({
        url: "https://example.com/api",
        method: "POST",
        body: JSON.stringify({ name: "test" }),
        timeout: 5000,
      });

      expect(capturedBody).toBe('{"name":"test"}');

      connectedClient.close();
    });

    it("should use correct HTTP method", async () => {
      let capturedMethod: string | undefined;
      spyOn(globalThis, "fetch").mockImplementation((async (
        _url: RequestInfo | URL,
        options?: RequestInit,
      ) => {
        capturedMethod = options?.method;
        return new Response(null, { status: 200 });
      }) as unknown as typeof fetch);

      const connectedClient = await strategy.createClient({ timeout: 5000 });
      await connectedClient.client.exec({
        url: "https://example.com/api",
        method: "DELETE",
        timeout: 5000,
      });

      expect(capturedMethod).toBe("DELETE");

      connectedClient.close();
    });
  });

  describe("mergeResult", () => {
    it("should count errors correctly", () => {
      const runs = [
        {
          id: "1",
          status: "unhealthy" as const,
          latencyMs: 100,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            error: "Connection refused",
          },
        },
        {
          id: "2",
          status: "healthy" as const,
          latencyMs: 150,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {},
        },
        {
          id: "3",
          status: "unhealthy" as const,
          latencyMs: 120,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            error: "Timeout",
          },
        },
      ];

      // Merge runs incrementally
      let aggregated = strategy.mergeResult(undefined, runs[0]);
      aggregated = strategy.mergeResult(aggregated, runs[1]);
      aggregated = strategy.mergeResult(aggregated, runs[2]);

      expect(aggregated.errorCount.count).toBe(2);
    });

    it("should return zero errors when all runs succeed", () => {
      const runs = [
        {
          id: "1",
          status: "healthy" as const,
          latencyMs: 100,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {},
        },
        {
          id: "2",
          status: "healthy" as const,
          latencyMs: 150,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {},
        },
      ];

      // Merge runs incrementally
      let aggregated = strategy.mergeResult(undefined, runs[0]);
      aggregated = strategy.mergeResult(aggregated, runs[1]);

      expect(aggregated.errorCount.count).toBe(0);
    });
  });
});
