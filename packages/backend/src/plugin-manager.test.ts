import { describe, it, expect, mock, beforeEach, spyOn } from "bun:test";
import { PluginManager } from "./plugin-manager";
import {
  createServiceRef,
  createExtensionPoint,
  ServiceRef,
} from "@checkmate/backend-api";

// Mock DB and other globals
mock.module("./db", () => ({
  adminPool: { query: mock(() => Promise.resolve()) },
  db: {
    select: mock(() => ({
      from: mock(() => ({
        where: mock(() => Promise.resolve([])),
      })),
    })),
  },
}));

const mockReaddirSync = mock(() => []);
const mockExistsSync = mock(() => true);

mock.module("node:fs", () => ({
  existsSync: mockExistsSync,
  readdirSync: mockReaddirSync,
  default: {
    existsSync: mockExistsSync,
    readdirSync: mockReaddirSync,
  },
}));

mock.module("./logger", () => ({
  rootLogger: {
    info: mock(),
    debug: mock(),
    warn: mock(),
    error: mock(),
    child: mock(() => ({
      info: mock(),
      debug: mock(),
      warn: mock(),
      error: mock(),
    })),
  },
}));

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

      const sorted = pluginManager.sortPlugins(pendingInits, providedBy);

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

      expect(() => pluginManager.sortPlugins(pendingInits, providedBy)).toThrow(
        "Circular dependency detected"
      );
    });
  });

  describe("loadPlugins", () => {
    it("should discover and initialize plugins", async () => {
      const mockRouter: any = {
        route: mock(),
        all: mock(),
        newResponse: mock(),
      };

      // Setup discovery mocks
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        { isDirectory: () => true, name: "test-backend" },
      ] as any);

      // Mock DB to return one remote plugin
      const mockDbPlugins = [
        {
          name: "remote-plugin",
          path: "/path/to/remote",
          enabled: true,
          type: "backend",
        },
      ];

      const { db } = await import("./db");
      (db.select as any).mockReturnValue({
        from: mock(() => ({
          where: mock(() => Promise.resolve(mockDbPlugins)),
        })),
      });

      // Mock dynamic imports
      const testBackendInit = mock(async () => {});
      const remotePluginInit = mock(async () => {});

      mock.module("test-backend", () => ({
        default: {
          pluginId: "test-backend",
          register: ({ registerInit }: any) => {
            registerInit({ deps: {}, init: testBackendInit });
          },
        },
      }));

      mock.module("/path/to/remote", () => ({
        default: {
          pluginId: "remote-plugin",
          register: ({ registerInit }: any) => {
            registerInit({ deps: {}, init: remotePluginInit });
          },
        },
      }));

      await pluginManager.loadPlugins(mockRouter);

      expect(testBackendInit).toHaveBeenCalled();
      expect(remotePluginInit).toHaveBeenCalled();
    });
  });
});
