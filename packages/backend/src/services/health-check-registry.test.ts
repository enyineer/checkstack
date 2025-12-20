import { describe, it, expect, mock, beforeEach } from "bun:test";
import { CoreHealthCheckRegistry } from "./health-check-registry";
import { HealthCheckStrategy } from "@checkmate/backend-api";

// Mock logger
mock.module("../logger", () => ({
  rootLogger: {
    info: mock(),
    warn: mock(),
  },
}));

describe("CoreHealthCheckRegistry", () => {
  let registry: CoreHealthCheckRegistry;

  const mockStrategy1: HealthCheckStrategy<any> = {
    id: "test-strategy-1",
    displayName: "Test Strategy 1",
    description: "A test strategy",
    configSchema: { type: "object", properties: {} } as any,
    execute: mock(async () => ({ status: "healthy" as const })),
  };

  const mockStrategy2: HealthCheckStrategy<any> = {
    id: "test-strategy-2",
    displayName: "Test Strategy 2",
    description: "Another test strategy",
    configSchema: { type: "object", properties: {} } as any,
    execute: mock(async () => ({
      status: "unhealthy" as const,
      message: "Error",
    })),
  };

  beforeEach(() => {
    registry = new CoreHealthCheckRegistry();
  });

  describe("register", () => {
    it("should register a new health check strategy", () => {
      registry.register(mockStrategy1);
      expect(registry.getStrategy(mockStrategy1.id)).toBe(mockStrategy1);
    });

    it("should overwrite an existing strategy with the same ID", () => {
      const overwritingStrategy: HealthCheckStrategy<any> = {
        ...mockStrategy1,
        displayName: "New Name",
      };
      registry.register(mockStrategy1);
      registry.register(overwritingStrategy);

      expect(registry.getStrategy(mockStrategy1.id)).toBe(overwritingStrategy);
      expect(registry.getStrategy(mockStrategy1.id)?.displayName).toBe(
        "New Name"
      );
    });
  });

  describe("getStrategySection", () => {
    it("should return the strategy if it exists", () => {
      registry.register(mockStrategy1);
      expect(registry.getStrategy(mockStrategy1.id)).toBe(mockStrategy1);
    });

    it("should return undefined if the strategy does not exist", () => {
      expect(registry.getStrategy("non-existent")).toBeUndefined();
    });
  });

  describe("getStrategies", () => {
    it("should return all registered strategies", () => {
      registry.register(mockStrategy1);
      registry.register(mockStrategy2);

      const strategies = registry.getStrategies();
      expect(strategies).toHaveLength(2);
      expect(strategies).toContain(mockStrategy1);
      expect(strategies).toContain(mockStrategy2);
    });

    it("should return an empty array if no strategies are registered", () => {
      expect(registry.getStrategies()).toEqual([]);
    });
  });
});
