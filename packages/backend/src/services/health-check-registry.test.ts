import { describe, it, expect, beforeEach, mock } from "bun:test";
import { CoreHealthCheckRegistry } from "./health-check-registry";
import { HealthCheckStrategy } from "@checkmate/backend-api";
import { createMockLogger } from "@checkmate/test-utils-backend";
import { z } from "zod";

// Mock logger
const mockLogger = createMockLogger();
mock.module("../logger", () => ({
  rootLogger: mockLogger,
}));

describe("CoreHealthCheckRegistry", () => {
  let registry: CoreHealthCheckRegistry;

  const mockStrategy1: HealthCheckStrategy<unknown> = {
    id: "test-strategy-1",
    displayName: "Test Strategy 1",
    description: "A test strategy",
    configVersion: 1, // Added configVersion
    configSchema: z.any(), // Changed configSchema
    execute: mock(() => Promise.resolve({ status: "healthy" as const })), // Modified execute
  };

  const mockStrategy2: HealthCheckStrategy<unknown> = {
    id: "test-strategy-2",
    displayName: "Test Strategy 2",
    description: "Another test strategy",
    configVersion: 1, // Added configVersion
    configSchema: z.any(), // Changed configSchema
    execute: mock(() =>
      Promise.resolve({ status: "unhealthy" as const, message: "Failed" })
    ), // Modified execute
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
