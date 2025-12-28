import { describe, expect, it, spyOn, afterEach } from "bun:test";
import { HttpHealthCheckStrategy, HttpHealthCheckConfig } from "./strategy";

describe("HttpHealthCheckStrategy Assertions", () => {
  const strategy = new HttpHealthCheckStrategy();
  const defaultConfig: HttpHealthCheckConfig = {
    url: "https://example.com/api",
    method: "GET",
    expectedStatus: 200,
    timeout: 5000,
  };

  afterEach(() => {
    spyOn(globalThis, "fetch").mockRestore();
  });

  it("should pass when status code matches and no assertions are present", async () => {
    spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 })
    );
    const result = await strategy.execute(defaultConfig);
    expect(result.status).toBe("healthy");
  });

  it("should fail when status code does not match", async () => {
    spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 404 })
    );
    const result = await strategy.execute(defaultConfig);
    expect(result.status).toBe("unhealthy");
    expect(result.message).toContain("Unexpected status code: 404");
  });

  it("should pass equals assertion", async () => {
    spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "UP" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const config: HttpHealthCheckConfig = {
      ...defaultConfig,
      assertions: [
        { path: "$.status", operator: "equals", expectedValue: "UP" },
      ],
    };

    const result = await strategy.execute(config);
    expect(result.status).toBe("healthy");
    expect(result.message).toContain("passed 1 assertions");
  });

  it("should fail equals assertion", async () => {
    spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "DOWN" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const config: HttpHealthCheckConfig = {
      ...defaultConfig,
      assertions: [
        { path: "$.status", operator: "equals", expectedValue: "UP" },
      ],
    };

    const result = await strategy.execute(config);
    expect(result.status).toBe("unhealthy");
    expect(result.message).toContain("Assertion failed");
    expect(result.message).toContain("Actual: DOWN");
  });

  it("should pass exists assertion", async () => {
    spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ version: "1.0.0" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const config: HttpHealthCheckConfig = {
      ...defaultConfig,
      assertions: [{ path: "$.version", operator: "exists" }],
    };

    const result = await strategy.execute(config);
    expect(result.status).toBe("healthy");
  });

  it("should fail exists assertion when path not found", async () => {
    spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ other: "data" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const config: HttpHealthCheckConfig = {
      ...defaultConfig,
      assertions: [{ path: "$.missing", operator: "exists" }],
    };

    const result = await strategy.execute(config);
    expect(result.status).toBe("unhealthy");
  });

  it("should pass contains assertion", async () => {
    spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "Hello World" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const config: HttpHealthCheckConfig = {
      ...defaultConfig,
      assertions: [
        { path: "$.message", operator: "contains", expectedValue: "Hello" },
      ],
    };

    const result = await strategy.execute(config);
    expect(result.status).toBe("healthy");
  });

  it("should pass matches (regex) assertion", async () => {
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
          path: "$.id",
          operator: "matches",
          expectedValue: "^[a-z]{3}-\\d{3}$",
        },
      ],
    };

    const result = await strategy.execute(config);
    expect(result.status).toBe("healthy");
  });

  it("should fail when response is not JSON but assertions exist", async () => {
    spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Not JSON", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      })
    );

    const config: HttpHealthCheckConfig = {
      ...defaultConfig,
      assertions: [{ path: "$.id", operator: "exists" }],
    };

    const result = await strategy.execute(config);
    expect(result.status).toBe("unhealthy");
    expect(result.message).toContain("Response is not valid JSON");
  });

  it("should pass numeric equals assertion", async () => {
    spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: 123 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const config: HttpHealthCheckConfig = {
      ...defaultConfig,
      assertions: [
        { path: "$.code", operator: "equals", expectedValue: "123" },
      ],
    };

    const result = await strategy.execute(config);
    expect(result.status).toBe("healthy");
  });

  it("should pass boolean equals assertion", async () => {
    spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ active: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const config: HttpHealthCheckConfig = {
      ...defaultConfig,
      assertions: [
        { path: "$.active", operator: "equals", expectedValue: "true" },
      ],
    };

    const result = await strategy.execute(config);
    expect(result.status).toBe("healthy");
  });
});
