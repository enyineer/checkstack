import { describe, it, expect, beforeEach, mock } from "bun:test";
import {
  CoreHealthCheckRegistry,
  createScopedHealthCheckRegistry,
} from "./health-check-registry";
import {
  HealthCheckStrategy,
  Versioned,
  VersionedAggregated,
  aggregatedCounter,
} from "@checkstack/backend-api";
import { createMockLogger } from "@checkstack/test-utils-backend";
import { z } from "zod";
import type { PluginMetadata } from "@checkstack/common";

// Mock logger
const mockLogger = createMockLogger();
mock.module("../logger", () => ({
  rootLogger: mockLogger,
}));

describe("CoreHealthCheckRegistry", () => {
  let registry: CoreHealthCheckRegistry;

  const mockOwner: PluginMetadata = { pluginId: "test-plugin" };

  const mockStrategy1: HealthCheckStrategy = {
    id: "test-strategy-1",
    displayName: "Test Strategy 1",
    description: "A test strategy",
    config: new Versioned({
      version: 1,
      schema: z.object({}),
    }),
    result: new Versioned({
      version: 1,
      schema: z.record(z.string(), z.unknown()),
    }),
    aggregatedResult: new VersionedAggregated({
      version: 1,
      fields: { count: aggregatedCounter({}) },
    }),
    createClient: mock(() =>
      Promise.resolve({ client: { exec: async () => ({}) }, close: () => {} }),
    ),
    mergeResult: mock(() => ({})),
  };

  const mockStrategy2: HealthCheckStrategy = {
    id: "test-strategy-2",
    displayName: "Test Strategy 2",
    description: "Another test strategy",
    config: new Versioned({
      version: 1,
      schema: z.object({}),
    }),
    result: new Versioned({
      version: 1,
      schema: z.record(z.string(), z.unknown()),
    }),
    aggregatedResult: new VersionedAggregated({
      version: 1,
      fields: { count: aggregatedCounter({}) },
    }),
    createClient: mock(() =>
      Promise.resolve({ client: { exec: async () => ({}) }, close: () => {} }),
    ),
    mergeResult: mock(() => ({})),
  };

  beforeEach(() => {
    registry = new CoreHealthCheckRegistry();
  });

  describe("registerWithOwner", () => {
    it("should register a new health check strategy with qualified ID", () => {
      registry.registerWithOwner(mockStrategy1, mockOwner);
      // Should be stored with qualified ID: ownerPluginId.strategyId
      const qualifiedId = `${mockOwner.pluginId}.${mockStrategy1.id}`;
      expect(registry.getStrategy(qualifiedId)).toBe(mockStrategy1);
    });

    it("should overwrite an existing strategy with the same qualified ID", () => {
      const overwritingStrategy: HealthCheckStrategy = {
        ...mockStrategy1,
        displayName: "New Name",
      };
      registry.registerWithOwner(mockStrategy1, mockOwner);
      registry.registerWithOwner(overwritingStrategy, mockOwner);

      const qualifiedId = `${mockOwner.pluginId}.${mockStrategy1.id}`;
      expect(registry.getStrategy(qualifiedId)).toBe(overwritingStrategy);
      expect(registry.getStrategy(qualifiedId)?.displayName).toBe("New Name");
    });
  });

  describe("getStrategy", () => {
    it("should return the strategy if it exists", () => {
      registry.registerWithOwner(mockStrategy1, mockOwner);
      const qualifiedId = `${mockOwner.pluginId}.${mockStrategy1.id}`;
      expect(registry.getStrategy(qualifiedId)).toBe(mockStrategy1);
    });

    it("should return undefined if the strategy does not exist", () => {
      expect(registry.getStrategy("non-existent")).toBeUndefined();
    });
  });

  describe("getStrategies", () => {
    it("should return all registered strategies", () => {
      registry.registerWithOwner(mockStrategy1, mockOwner);
      registry.registerWithOwner(mockStrategy2, mockOwner);

      const strategies = registry.getStrategies();
      expect(strategies).toHaveLength(2);
      expect(strategies).toContain(mockStrategy1);
      expect(strategies).toContain(mockStrategy2);
    });

    it("should return an empty array if no strategies are registered", () => {
      expect(registry.getStrategies()).toEqual([]);
    });
  });

  describe("createScopedHealthCheckRegistry", () => {
    it("should auto-qualify strategy IDs on register", () => {
      const scoped = createScopedHealthCheckRegistry(registry, mockOwner);
      scoped.register(mockStrategy1);

      // The scoped registry should auto-prefix with pluginId
      const qualifiedId = `${mockOwner.pluginId}.${mockStrategy1.id}`;
      expect(registry.getStrategy(qualifiedId)).toBe(mockStrategy1);
    });

    it("should lookup strategies by both qualified and unqualified ID", () => {
      const scoped = createScopedHealthCheckRegistry(registry, mockOwner);
      scoped.register(mockStrategy1);

      // Should be able to lookup by unqualified ID in scoped registry
      expect(scoped.getStrategy(mockStrategy1.id)).toBe(mockStrategy1);

      // Should also work with qualified ID
      const qualifiedId = `${mockOwner.pluginId}.${mockStrategy1.id}`;
      expect(scoped.getStrategy(qualifiedId)).toBe(mockStrategy1);
    });
  });
});
