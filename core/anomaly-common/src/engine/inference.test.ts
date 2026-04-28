import { describe, test, expect } from "bun:test";
import { inferAnomalyDirection } from "./inference";

describe("Anomaly Engine - Direction Inference", () => {
  test("uses explicit override from meta if provided", () => {
    expect(inferAnomalyDirection("line", "ms", { "x-anomaly-direction": "higher-is-better" }))
      .toBe("higher-is-better");
  });

  test("infers lower-is-better for time-based line charts", () => {
    // Latency
    expect(inferAnomalyDirection("line", "ms")).toBe("lower-is-better");
    expect(inferAnomalyDirection("line", "s")).toBe("lower-is-better");
    expect(inferAnomalyDirection("line", "minutes")).toBe("lower-is-better");
  });

  test("infers higher-is-better for percentage line charts", () => {
    // Availability
    expect(inferAnomalyDirection("line", "%")).toBe("higher-is-better");
  });

  test("infers higher-is-better for percentage gauge charts", () => {
    // Success rates
    expect(inferAnomalyDirection("gauge", "%")).toBe("higher-is-better");
  });

  test("defaults to deviation for standard numeric gauges", () => {
    // e.g. active connections, memory usage
    expect(inferAnomalyDirection("gauge", "connections")).toBe("deviation");
    expect(inferAnomalyDirection("gauge", "mb")).toBe("deviation");
  });

  test("defaults to deviation for line charts with generic units", () => {
    // e.g. requests per second
    expect(inferAnomalyDirection("line", "req/s")).toBe("deviation");
  });

  test("defaults to deviation for missing chart types or unmapped types", () => {
    expect(inferAnomalyDirection()).toBe("deviation");
    expect(inferAnomalyDirection("text")).toBe("deviation");
    expect(inferAnomalyDirection("boolean")).toBe("deviation");
    // @ts-ignore
    expect(inferAnomalyDirection("unknown_type")).toBe("deviation");
  });
});
