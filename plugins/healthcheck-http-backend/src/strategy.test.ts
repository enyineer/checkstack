import { describe, expect, it, spyOn, afterEach } from "bun:test";
import { HttpHealthCheckStrategy, HttpHealthCheckConfig } from "./strategy";

describe("HttpHealthCheckStrategy", () => {
  const strategy = new HttpHealthCheckStrategy();
  const defaultConfig: HttpHealthCheckConfig = {
    url: "https://example.com/api",
    method: "GET",
    timeout: 5000,
  };

  afterEach(() => {
    spyOn(globalThis, "fetch").mockRestore();
  });

  describe("basic execution", () => {
    it("should return healthy for successful response without assertions", async () => {
      spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(null, { status: 200 })
      );
      const result = await strategy.execute(defaultConfig);
      expect(result.status).toBe("healthy");
      expect(result.metadata?.statusCode).toBe(200);
    });

    it("should return healthy for any status without status assertion", async () => {
      spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(null, { status: 404 })
      );
      const result = await strategy.execute(defaultConfig);
      // Without assertions, any response is "healthy" if reachable
      expect(result.status).toBe("healthy");
      expect(result.metadata?.statusCode).toBe(404);
    });
  });

  describe("statusCode assertions", () => {
    it("should pass statusCode equals assertion", async () => {
      spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(null, { status: 200 })
      );

      const config: HttpHealthCheckConfig = {
        ...defaultConfig,
        assertions: [{ field: "statusCode", operator: "equals", value: 200 }],
      };

      const result = await strategy.execute(config);
      expect(result.status).toBe("healthy");
    });

    it("should fail statusCode equals assertion when mismatch", async () => {
      spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(null, { status: 404 })
      );

      const config: HttpHealthCheckConfig = {
        ...defaultConfig,
        assertions: [{ field: "statusCode", operator: "equals", value: 200 }],
      };

      const result = await strategy.execute(config);
      expect(result.status).toBe("unhealthy");
      expect(result.message).toContain("statusCode");
    });

    it("should pass statusCode lessThan assertion", async () => {
      spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(null, { status: 201 })
      );

      const config: HttpHealthCheckConfig = {
        ...defaultConfig,
        assertions: [{ field: "statusCode", operator: "lessThan", value: 300 }],
      };

      const result = await strategy.execute(config);
      expect(result.status).toBe("healthy");
    });
  });

  describe("responseTime assertions", () => {
    it("should pass responseTime assertion when fast", async () => {
      spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(null, { status: 200 })
      );

      const config: HttpHealthCheckConfig = {
        ...defaultConfig,
        assertions: [
          { field: "responseTime", operator: "lessThan", value: 10000 },
        ],
      };

      const result = await strategy.execute(config);
      expect(result.status).toBe("healthy");
    });
  });

  describe("contentType assertions", () => {
    it("should pass contentType contains assertion", async () => {
      spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        })
      );

      const config: HttpHealthCheckConfig = {
        ...defaultConfig,
        assertions: [
          { field: "contentType", operator: "contains", value: "json" },
        ],
      };

      const result = await strategy.execute(config);
      expect(result.status).toBe("healthy");
    });
  });

  describe("header assertions", () => {
    it("should pass header exists assertion", async () => {
      spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(null, {
          status: 200,
          headers: { "X-Request-Id": "abc123" },
        })
      );

      const config: HttpHealthCheckConfig = {
        ...defaultConfig,
        assertions: [
          { field: "header", headerName: "X-Request-Id", operator: "exists" },
        ],
      };

      const result = await strategy.execute(config);
      expect(result.status).toBe("healthy");
    });

    it("should fail header exists assertion when missing", async () => {
      spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(null, { status: 200 })
      );

      const config: HttpHealthCheckConfig = {
        ...defaultConfig,
        assertions: [
          { field: "header", headerName: "X-Missing", operator: "exists" },
        ],
      };

      const result = await strategy.execute(config);
      expect(result.status).toBe("unhealthy");
      expect(result.message).toContain("X-Missing");
    });

    it("should pass header equals assertion", async () => {
      spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(null, {
          status: 200,
          headers: { "Cache-Control": "no-cache" },
        })
      );

      const config: HttpHealthCheckConfig = {
        ...defaultConfig,
        assertions: [
          {
            field: "header",
            headerName: "Cache-Control",
            operator: "equals",
            value: "no-cache",
          },
        ],
      };

      const result = await strategy.execute(config);
      expect(result.status).toBe("healthy");
    });
  });

  describe("jsonPath assertions", () => {
    it("should pass jsonPath equals assertion", async () => {
      spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ status: "UP" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const config: HttpHealthCheckConfig = {
        ...defaultConfig,
        assertions: [
          {
            field: "jsonPath",
            path: "$.status",
            operator: "equals",
            value: "UP",
          },
        ],
      };

      const result = await strategy.execute(config);
      expect(result.status).toBe("healthy");
    });

    it("should fail jsonPath equals assertion", async () => {
      spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ status: "DOWN" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const config: HttpHealthCheckConfig = {
        ...defaultConfig,
        assertions: [
          {
            field: "jsonPath",
            path: "$.status",
            operator: "equals",
            value: "UP",
          },
        ],
      };

      const result = await strategy.execute(config);
      expect(result.status).toBe("unhealthy");
      expect(result.message).toContain("Actual");
    });

    it("should pass jsonPath exists assertion", async () => {
      spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ version: "1.0.0" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const config: HttpHealthCheckConfig = {
        ...defaultConfig,
        assertions: [
          { field: "jsonPath", path: "$.version", operator: "exists" },
        ],
      };

      const result = await strategy.execute(config);
      expect(result.status).toBe("healthy");
    });

    it("should fail jsonPath exists assertion when path not found", async () => {
      spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ other: "data" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const config: HttpHealthCheckConfig = {
        ...defaultConfig,
        assertions: [
          { field: "jsonPath", path: "$.missing", operator: "exists" },
        ],
      };

      const result = await strategy.execute(config);
      expect(result.status).toBe("unhealthy");
    });

    it("should pass jsonPath contains assertion", async () => {
      spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ message: "Hello World" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const config: HttpHealthCheckConfig = {
        ...defaultConfig,
        assertions: [
          {
            field: "jsonPath",
            path: "$.message",
            operator: "contains",
            value: "Hello",
          },
        ],
      };

      const result = await strategy.execute(config);
      expect(result.status).toBe("healthy");
    });

    it("should pass jsonPath matches (regex) assertion", async () => {
      spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ id: "abc-123" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const config: HttpHealthCheckConfig = {
        ...defaultConfig,
        assertions: [
          {
            field: "jsonPath",
            path: "$.id",
            operator: "matches",
            value: "^[a-z]{3}-\\d{3}$",
          },
        ],
      };

      const result = await strategy.execute(config);
      expect(result.status).toBe("healthy");
    });

    it("should fail when response is not JSON but jsonPath assertions exist", async () => {
      spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("Not JSON", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        })
      );

      const config: HttpHealthCheckConfig = {
        ...defaultConfig,
        assertions: [{ field: "jsonPath", path: "$.id", operator: "exists" }],
      };

      const result = await strategy.execute(config);
      expect(result.status).toBe("unhealthy");
      expect(result.message).toContain("not valid JSON");
    });
  });

  describe("combined assertions", () => {
    it("should pass multiple assertion types", async () => {
      spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ healthy: true }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "X-Request-Id": "test-123",
          },
        })
      );

      const config: HttpHealthCheckConfig = {
        ...defaultConfig,
        assertions: [
          { field: "statusCode", operator: "equals", value: 200 },
          { field: "responseTime", operator: "lessThan", value: 10000 },
          { field: "contentType", operator: "contains", value: "json" },
          { field: "header", headerName: "X-Request-Id", operator: "exists" },
          {
            field: "jsonPath",
            path: "$.healthy",
            operator: "equals",
            value: "true",
          },
        ],
      };

      const result = await strategy.execute(config);
      expect(result.status).toBe("healthy");
      expect(result.message).toContain("5 assertion");
    });
  });

  describe("custom request options", () => {
    it("should send custom headers with request", async () => {
      let capturedHeaders: Record<string, string> | undefined;
      spyOn(globalThis, "fetch").mockImplementation((async (
        _url: RequestInfo | URL,
        options?: RequestInit
      ) => {
        capturedHeaders = options?.headers as Record<string, string>;
        return new Response(null, { status: 200 });
      }) as unknown as typeof fetch);

      const config: HttpHealthCheckConfig = {
        ...defaultConfig,
        headers: [
          { name: "Authorization", value: "Bearer my-token" },
          { name: "X-Custom-Header", value: "custom-value" },
        ],
      };

      const result = await strategy.execute(config);
      expect(result.status).toBe("healthy");
      expect(capturedHeaders).toBeDefined();
      expect(capturedHeaders?.["Authorization"]).toBe("Bearer my-token");
      expect(capturedHeaders?.["X-Custom-Header"]).toBe("custom-value");
    });
  });
});
