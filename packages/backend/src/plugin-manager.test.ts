import { describe, it, expect, mock, beforeEach } from "bun:test";
import { PluginManager } from "./plugin-manager";
import {
  createServiceRef,
  createExtensionPoint,
  ServiceRef,
} from "@checkmate/backend-api";
import {
  createMockDbModule,
  createMockLoggerModule,
  createMockLogger,
} from "@checkmate/test-utils-backend";
import { sortPlugins } from "./plugin-manager/dependency-sorter";

// Mock DB and other globals
mock.module("./db", () => createMockDbModule());

mock.module("./logger", () => createMockLoggerModule());

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
      (pluginManager as any).registerExtensionPoint(testEPRef, mockImpl);

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
      (pluginManager as any).registerExtensionPoint(testEPRef, mockImpl);

      // 4. Verify the buffered call was replayed
      expect(mockImpl.addThing).toHaveBeenCalledWith("buffered-call");
    });
  });

  describe("sortPlugins (Topological Sort)", () => {
    it("should sort plugins based on their dependencies", () => {
      const s1 = createServiceRef<any>("service-1");
      const s2 = createServiceRef<any>("service-2");

      const pendingInits = [
        {
          pluginId: "consumer",
          deps: { d1: s1, d2: s2 } as Record<string, ServiceRef<unknown>>,
        },
        {
          pluginId: "provider-1",
          deps: {} as Record<string, ServiceRef<unknown>>,
        },
        {
          pluginId: "provider-2",
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
      const s1 = createServiceRef<any>("service-1");
      const s2 = createServiceRef<any>("service-2");

      const pendingInits = [
        { pluginId: "p1", deps: { d: s2 } },
        { pluginId: "p2", deps: { d: s1 } },
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
        const queueFactoryRef = createServiceRef<any>("core.queue-factory");
        const queueRegistryRef = createServiceRef<any>(
          "core.queue-plugin-registry"
        );

        const pendingInits = [
          {
            pluginId: "queue-consumer",
            deps: { queueFactory: queueFactoryRef } as Record<
              string,
              ServiceRef<unknown>
            >,
          },
          {
            pluginId: "queue-provider",
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
        const queueFactoryRef = createServiceRef<any>("core.queue-factory");
        const queueRegistryRef = createServiceRef<any>(
          "core.queue-plugin-registry"
        );
        const loggerRef = createServiceRef<any>("core.logger");

        const pendingInits = [
          {
            pluginId: "consumer-1",
            deps: { queueFactory: queueFactoryRef } as Record<
              string,
              ServiceRef<unknown>
            >,
          },
          {
            pluginId: "provider-1",
            deps: { queuePluginRegistry: queueRegistryRef } as Record<
              string,
              ServiceRef<unknown>
            >,
          },
          {
            pluginId: "consumer-2",
            deps: { queueFactory: queueFactoryRef } as Record<
              string,
              ServiceRef<unknown>
            >,
          },
          {
            pluginId: "provider-2",
            deps: { queuePluginRegistry: queueRegistryRef } as Record<
              string,
              ServiceRef<unknown>
            >,
          },
          {
            pluginId: "unrelated",
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
        const queueFactoryRef = createServiceRef<any>("core.queue-factory");
        const queueRegistryRef = createServiceRef<any>(
          "core.queue-plugin-registry"
        );
        const customServiceRef = createServiceRef<any>("custom.service");
        const loggerRef = createServiceRef<any>("core.logger");

        const pendingInits = [
          {
            pluginId: "queue-consumer",
            deps: {
              queueFactory: queueFactoryRef,
              customService: customServiceRef,
            } as Record<string, ServiceRef<unknown>>,
          },
          {
            pluginId: "queue-provider",
            deps: { queuePluginRegistry: queueRegistryRef } as Record<
              string,
              ServiceRef<unknown>
            >,
          },
          {
            pluginId: "provider-plugin",
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
        const queueFactoryRef = createServiceRef<any>("core.queue-factory");
        const queueRegistryRef = createServiceRef<any>(
          "core.queue-plugin-registry"
        );

        const pendingInits = [
          {
            pluginId: "dual-plugin",
            deps: {
              queuePluginRegistry: queueRegistryRef,
              queueFactory: queueFactoryRef,
            } as Record<string, ServiceRef<unknown>>,
          },
          {
            pluginId: "consumer-only",
            deps: { queueFactory: queueFactoryRef } as Record<
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
        const queueFactoryRef = createServiceRef<any>("core.queue-factory");
        const queueRegistryRef = createServiceRef<any>(
          "core.queue-plugin-registry"
        );

        const pendingInits = [
          {
            pluginId: "queue-provider",
            deps: { queuePluginRegistry: queueRegistryRef } as Record<
              string,
              ServiceRef<unknown>
            >,
          },
          {
            pluginId: "queue-consumer",
            deps: { queueFactory: queueFactoryRef } as Record<
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

  describe("Permission and Hook Deferral", () => {
    it("should defer permission hook emissions until after initialization", () => {
      // Call registerPermissions during the "register" phase
      (pluginManager as any).registerPermissions("test-plugin", [
        { id: "test.permission", description: "Test permission" },
      ]);

      // At this point, the hook should NOT have been emitted yet
      // Deferred registrations should be stored
      const deferred = (pluginManager as any).deferredPermissionRegistrations;
      expect(deferred.length).toBe(1);
      expect(deferred[0]).toEqual({
        pluginId: "test-plugin",
        permissions: [
          {
            id: "test-plugin.test.permission",
            description: "Test permission",
          },
        ],
      });
    });

    it("should store multiple deferred permission registrations", () => {
      (pluginManager as any).registerPermissions("plugin-1", [
        { id: "perm.1" },
        { id: "perm.2" },
      ]);
      (pluginManager as any).registerPermissions("plugin-2", [
        { id: "perm.3" },
      ]);

      const deferred = (pluginManager as any).deferredPermissionRegistrations;
      expect(deferred.length).toBe(2);
      expect(deferred[0].pluginId).toBe("plugin-1");
      expect(deferred[1].pluginId).toBe("plugin-2");
      expect(deferred[0].permissions.length).toBe(2);
      expect(deferred[1].permissions.length).toBe(1);
    });
  });

  describe("loadPlugins", () => {
    it("should discover and initialize plugins", async () => {
      const mockRouter: any = {
        route: mock(),
        all: mock(),
        newResponse: mock(),
      };

      // Mock dynamic imports
      const testBackendInit = mock(async () => {});

      const testPlugin = {
        pluginId: "test-backend",
        register: ({ registerInit }: any) => {
          registerInit({ deps: {}, init: testBackendInit });
        },
      };

      // Use manual plugin injection to avoid filesystem mocking issues
      await pluginManager.loadPlugins(mockRouter, [testPlugin]);

      expect(testBackendInit).toHaveBeenCalled();
    });
  });
});
