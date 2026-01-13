import { describe, it, expect, mock, beforeEach } from "bun:test";
import {
  createServiceRef,
  createExtensionPoint,
  createBackendPlugin,
  ServiceRef,
  coreServices,
} from "@checkstack/backend-api";
import {
  createMockLogger,
  createMockQueueManager,
} from "@checkstack/test-utils-backend";
import { sortPlugins } from "./plugin-manager/dependency-sorter";

// Note: ./db and ./logger are mocked via test-preload.ts (bunfig.toml preload)
// This ensures mocks are in place BEFORE any module imports them

import { PluginManager } from "./plugin-manager";

describe("PluginManager", () => {
  let pluginManager: PluginManager;

  beforeEach(() => {
    pluginManager = new PluginManager();
  });

  describe("Service Registration", () => {
    it("should register and retrieve a global service", async () => {
      const testServiceRef = createServiceRef<{ foo: string }>("test.service");
      const testImpl = { foo: "bar" };

      pluginManager.registerService(testServiceRef, testImpl);
      const retrieved = await pluginManager.getService(testServiceRef);

      expect(retrieved).toBe(testImpl);
    });

    it("should return undefined for unregistered service", async () => {
      const testServiceRef = createServiceRef<{ foo: string }>("test.service");
      const retrieved = await pluginManager.getService(testServiceRef);

      expect(retrieved).toBeUndefined();
    });
  });

  describe("Extension Points", () => {
    interface TestExtensionPoint {
      addThing(name: string): void;
    }

    it("should allow registering and getting an extension point", () => {
      const testEPRef = createExtensionPoint<TestExtensionPoint>("test.ep");
      const mockImpl: TestExtensionPoint = {
        addThing: mock(),
      };

      // In the real flow, a plugin calls registerExtensionPoint
      // which sets the implementation on the proxy
      // We can simulate this by mocking the environment passed to register
      pluginManager["registerExtensionPoint"](testEPRef, mockImpl);

      const ep = pluginManager.getExtensionPoint(testEPRef);
      ep.addThing("hello");

      expect(mockImpl.addThing).toHaveBeenCalledWith("hello");
    });

    it("should buffer calls to extension points before they are registered", () => {
      const testEPRef = createExtensionPoint<TestExtensionPoint>("test.ep");

      // 1. Get the proxy before implementation is registered
      const ep = pluginManager.getExtensionPoint(testEPRef);

      // 2. Call a method on the proxy
      ep.addThing("buffered-call");

      const mockImpl: TestExtensionPoint = {
        addThing: mock(),
      };

      // 3. Register the implementation
      pluginManager["registerExtensionPoint"](testEPRef, mockImpl);

      // 4. Verify the buffered call was replayed
      expect(mockImpl.addThing).toHaveBeenCalledWith("buffered-call");
    });
  });

  describe("sortPlugins (Topological Sort)", () => {
    it("should sort plugins based on their dependencies", () => {
      const s1 = createServiceRef<unknown>("service-1");
      const s2 = createServiceRef<unknown>("service-2");

      const pendingInits = [
        {
          metadata: { pluginId: "consumer" },
          deps: { d1: s1, d2: s2 } as Record<string, ServiceRef<unknown>>,
        },
        {
          metadata: { pluginId: "provider-1" },
          deps: {} as Record<string, ServiceRef<unknown>>,
        },
        {
          metadata: { pluginId: "provider-2" },
          deps: { d1: s1 } as Record<string, ServiceRef<unknown>>,
        },
      ];

      const providedBy = new Map([
        [s1.id, "provider-1"],
        [s2.id, "provider-2"],
      ]);

      const sorted = sortPlugins({
        pendingInits,
        providedBy,
        logger: createMockLogger(),
      });

      // provider-1 must come before consumer and provider-2
      // provider-2 must come before consumer
      expect(sorted.indexOf("provider-1")).toBeLessThan(
        sorted.indexOf("consumer")
      );
      expect(sorted.indexOf("provider-1")).toBeLessThan(
        sorted.indexOf("provider-2")
      );
      expect(sorted.indexOf("provider-2")).toBeLessThan(
        sorted.indexOf("consumer")
      );
    });

    it("should throw error on circular dependency", () => {
      const s1 = createServiceRef<unknown>("service-1");
      const s2 = createServiceRef<unknown>("service-2");

      const pendingInits = [
        { metadata: { pluginId: "p1" }, deps: { d: s2 } },
        { metadata: { pluginId: "p2" }, deps: { d: s1 } },
      ];

      const providedBy = new Map([
        [s1.id, "p1"],
        [s2.id, "p2"],
      ]);

      expect(() =>
        sortPlugins({ pendingInits, providedBy, logger: createMockLogger() })
      ).toThrow("Circular dependency detected");
    });

    describe("Queue Plugin Ordering", () => {
      it("should initialize queue plugin providers before queue consumers", () => {
        const queueManagerRef = createServiceRef<unknown>(
          coreServices.queueManager.id
        );
        const queueRegistryRef = createServiceRef<unknown>(
          coreServices.queuePluginRegistry.id
        );

        const pendingInits = [
          {
            metadata: { pluginId: "queue-consumer" },
            deps: { queueManager: queueManagerRef } as Record<
              string,
              ServiceRef<unknown>
            >,
          },
          {
            metadata: { pluginId: "queue-provider" },
            deps: { queuePluginRegistry: queueRegistryRef } as Record<
              string,
              ServiceRef<unknown>
            >,
          },
        ];

        const providedBy = new Map<string, string>();
        const sorted = sortPlugins({
          pendingInits,
          providedBy,
          logger: createMockLogger(),
        });

        // Queue provider should come before queue consumer
        expect(sorted.indexOf("queue-provider")).toBeLessThan(
          sorted.indexOf("queue-consumer")
        );
      });

      it("should handle multiple queue providers and consumers", () => {
        const queueManagerRef = createServiceRef<unknown>(
          coreServices.queueManager.id
        );
        const queueRegistryRef = createServiceRef<unknown>(
          coreServices.queuePluginRegistry.id
        );
        const loggerRef = createServiceRef<unknown>("core.logger");

        const pendingInits = [
          {
            metadata: { pluginId: "consumer-1" },
            deps: { queueManager: queueManagerRef } as Record<
              string,
              ServiceRef<unknown>
            >,
          },
          {
            metadata: { pluginId: "provider-1" },
            deps: { queuePluginRegistry: queueRegistryRef } as Record<
              string,
              ServiceRef<unknown>
            >,
          },
          {
            metadata: { pluginId: "consumer-2" },
            deps: { queueManager: queueManagerRef } as Record<
              string,
              ServiceRef<unknown>
            >,
          },
          {
            metadata: { pluginId: "provider-2" },
            deps: { queuePluginRegistry: queueRegistryRef } as Record<
              string,
              ServiceRef<unknown>
            >,
          },
          {
            metadata: { pluginId: "unrelated" },
            deps: { logger: loggerRef } as Record<string, ServiceRef<unknown>>,
          },
        ];

        const providedBy = new Map<string, string>();
        const sorted = sortPlugins({
          pendingInits,
          providedBy,
          logger: createMockLogger(),
        });

        // All providers should come before all consumers
        const provider1Index = sorted.indexOf("provider-1");
        const provider2Index = sorted.indexOf("provider-2");
        const consumer1Index = sorted.indexOf("consumer-1");
        const consumer2Index = sorted.indexOf("consumer-2");

        expect(provider1Index).toBeLessThan(consumer1Index);
        expect(provider1Index).toBeLessThan(consumer2Index);
        expect(provider2Index).toBeLessThan(consumer1Index);
        expect(provider2Index).toBeLessThan(consumer2Index);
      });

      it("should respect existing service dependencies while prioritizing queue plugins", () => {
        const queueManagerRef = createServiceRef<unknown>(
          coreServices.queueManager.id
        );
        const queueRegistryRef = createServiceRef<unknown>(
          coreServices.queuePluginRegistry.id
        );
        const customServiceRef = createServiceRef<unknown>("custom.service");
        const loggerRef = createServiceRef<unknown>("core.logger");

        const pendingInits = [
          {
            metadata: { pluginId: "queue-consumer" },
            deps: {
              queueManager: queueManagerRef,
              customService: customServiceRef,
            } as Record<string, ServiceRef<unknown>>,
          },
          {
            metadata: { pluginId: "queue-provider" },
            deps: { queuePluginRegistry: queueRegistryRef } as Record<
              string,
              ServiceRef<unknown>
            >,
          },
          {
            metadata: { pluginId: "provider-plugin" },
            deps: { logger: loggerRef } as Record<string, ServiceRef<unknown>>,
          },
        ];

        const providedBy = new Map<string, string>([
          [customServiceRef.id, "provider-plugin"],
        ]);

        const sorted = sortPlugins({
          pendingInits,
          providedBy,
          logger: createMockLogger(),
        });

        // Queue provider should come before queue consumer
        const queueProviderIndex = sorted.indexOf("queue-provider");
        const queueConsumerIndex = sorted.indexOf("queue-consumer");
        expect(queueProviderIndex).toBeLessThan(queueConsumerIndex);

        // Provider plugin should come before queue consumer (due to service dependency)
        const providerPluginIndex = sorted.indexOf("provider-plugin");
        expect(providerPluginIndex).toBeLessThan(queueConsumerIndex);
      });

      it("should handle plugins that both provide and consume queues", () => {
        const queueManagerRef = createServiceRef<unknown>(
          coreServices.queueManager.id
        );
        const queueRegistryRef = createServiceRef<unknown>(
          coreServices.queuePluginRegistry.id
        );

        const pendingInits = [
          {
            metadata: { pluginId: "dual-plugin" },
            deps: {
              queuePluginRegistry: queueRegistryRef,
              queueManager: queueManagerRef,
            } as Record<string, ServiceRef<unknown>>,
          },
          {
            metadata: { pluginId: "consumer-only" },
            deps: { queueManager: queueManagerRef } as Record<
              string,
              ServiceRef<unknown>
            >,
          },
        ];

        const providedBy = new Map<string, string>();
        const sorted = sortPlugins({
          pendingInits,
          providedBy,
          logger: createMockLogger(),
        });

        // Dual plugin should come before consumer-only
        const dualIndex = sorted.indexOf("dual-plugin");
        const consumerIndex = sorted.indexOf("consumer-only");
        expect(dualIndex).toBeLessThan(consumerIndex);
      });

      it("should not create circular dependencies with queue ordering", () => {
        const queueManagerRef = createServiceRef<unknown>(
          coreServices.queueManager.id
        );
        const queueRegistryRef = createServiceRef<unknown>(
          coreServices.queuePluginRegistry.id
        );

        const pendingInits = [
          {
            metadata: { pluginId: "queue-provider" },
            deps: { queuePluginRegistry: queueRegistryRef } as Record<
              string,
              ServiceRef<unknown>
            >,
          },
          {
            metadata: { pluginId: "queue-consumer" },
            deps: { queueManager: queueManagerRef } as Record<
              string,
              ServiceRef<unknown>
            >,
          },
        ];

        const providedBy = new Map<string, string>();

        // Should not throw
        expect(() => {
          sortPlugins({ pendingInits, providedBy, logger: createMockLogger() });
        }).not.toThrow();
      });
    });
  });

  describe("Access Rule Registration", () => {
    it("should store access rules in the registry", () => {
      // Access rules are now stored directly via the registeredAccessRules array
      // and hooks are emitted in Phase 3 (afterPluginsReady)
      const perms = (
        pluginManager as unknown as {
          registeredAccessRules: {
            pluginId: string;
            id: string;
            resource: string;
            level: string;
            description: string;
          }[];
        }
      ).registeredAccessRules;

      // Add access rules directly (simulating what plugin-loader does)
      perms.push({
        pluginId: "test-plugin",
        id: "test-plugin.test.accessRule",
        resource: "test",
        level: "read",
        description: "Test access rule",
      });

      // getAllAccessRules should return them (without pluginId in the output)
      const all = pluginManager.getAllAccessRules();
      expect(all.length).toBe(1);
      expect(all[0].id).toBe("test-plugin.test.accessRule");
      expect(all[0].description).toBe("Test access rule");
    });

    it("should aggregate access rules from multiple plugins", () => {
      const perms = (
        pluginManager as unknown as {
          registeredAccessRules: {
            pluginId: string;
            id: string;
            resource: string;
            level: string;
            description: string;
          }[];
        }
      ).registeredAccessRules;

      perms.push(
        {
          pluginId: "plugin-1",
          id: "plugin-1.perm.1",
          resource: "perm",
          level: "read",
          description: "Access Rule 1",
        },
        {
          pluginId: "plugin-1",
          id: "plugin-1.perm.2",
          resource: "perm",
          level: "manage",
          description: "Access Rule 2",
        },
        {
          pluginId: "plugin-2",
          id: "plugin-2.perm.3",
          resource: "perm",
          level: "read",
          description: "Access Rule 3",
        }
      );

      const all = pluginManager.getAllAccessRules();
      expect(all.length).toBe(3);
    });
  });

  describe("loadPlugins", () => {
    it("should discover and initialize plugins", async () => {
      const mockRouter = {
        route: mock(),
        all: mock(),
        newResponse: mock(),
      } as never;

      // Mock dynamic imports
      const testBackendInit = mock(async () => {});

      const testPlugin = createBackendPlugin({
        metadata: { pluginId: "test-backend" },
        register(env) {
          env.registerInit({ deps: {}, init: testBackendInit });
        },
      });

      // Register mock services since core-services is mocked as no-op
      pluginManager.registerService(
        coreServices.queueManager,
        createMockQueueManager()
      );
      pluginManager.registerService(coreServices.logger, createMockLogger());
      pluginManager.registerService(coreServices.database, {} as never); // Mock database

      // Use manual plugin injection with skipDiscovery to avoid loading real plugins
      await pluginManager.loadPlugins(mockRouter, [testPlugin], {
        skipDiscovery: true,
      });

      expect(testBackendInit).toHaveBeenCalled();
    });
  });
});
