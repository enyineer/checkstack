import {
  describe,
  it,
  expect,
  mock,
  beforeAll,
  beforeEach,
  spyOn,
} from "bun:test";
import {
  createMockDbModule,
  createMockLoggerModule,
  createMockEventBus,
  createMockPluginInstaller,
  createMockQueueManager,
  type MockEventBus,
  type MockPluginInstaller,
} from "@checkmate-monitor/test-utils-backend";
import { coreServices, coreHooks } from "@checkmate-monitor/backend-api";

// Mock DB and logger BEFORE importing PluginManager
mock.module("./db", () => createMockDbModule());
mock.module("./logger", () => createMockLoggerModule());

// Use dynamic import to ensure mocks are applied first
// Static imports are hoisted above mock.module() calls, causing TDZ errors in CI
let PluginManager: typeof import("./plugin-manager").PluginManager;

beforeAll(async () => {
  const mod = await import("./plugin-manager");
  PluginManager = mod.PluginManager;
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Plugin Lifecycle", () => {
  let pluginManager: InstanceType<typeof PluginManager>;
  let mockEventBus: MockEventBus;
  let mockInstaller: MockPluginInstaller;

  beforeEach(() => {
    pluginManager = new PluginManager();
    mockEventBus = createMockEventBus();
    mockInstaller = createMockPluginInstaller();

    // Access internal registry to override factory (factories take precedence)
    const registry = (pluginManager as never)["registry"] as {
      registerFactory: <T>(ref: { id: string }, factory: () => T) => void;
      register: <T>(ref: { id: string }, impl: T) => void;
    };

    // Override EventBus factory with our mock
    registry.registerFactory(
      coreServices.eventBus,
      () => mockEventBus as never
    );

    // Register services
    registry.register(coreServices.pluginInstaller, mockInstaller as never);
    registry.register(
      coreServices.queueManager,
      createMockQueueManager() as never
    );
  });

  describe("requestInstallation", () => {
    it("should emit pluginInstallationRequested broadcast", async () => {
      await pluginManager.requestInstallation("test-plugin", "/path/to/plugin");

      expect(mockEventBus._emittedEvents).toContainEqual({
        hook: coreHooks.pluginInstallationRequested.id,
        payload: { pluginId: "test-plugin", pluginPath: "/path/to/plugin" },
      });
    });
  });

  describe("requestDeregistration", () => {
    it("should emit pluginDeregistrationRequested broadcast", async () => {
      await pluginManager.requestDeregistration("test-plugin", {
        deleteSchema: false,
      });

      expect(mockEventBus._emittedEvents).toContainEqual({
        hook: coreHooks.pluginDeregistrationRequested.id,
        payload: { pluginId: "test-plugin", deleteSchema: false },
      });
    });

    it("should include deleteSchema flag in broadcast", async () => {
      await pluginManager.requestDeregistration("test-plugin", {
        deleteSchema: true,
      });

      expect(mockEventBus._emittedEvents).toContainEqual({
        hook: coreHooks.pluginDeregistrationRequested.id,
        payload: { pluginId: "test-plugin", deleteSchema: true },
      });
    });
  });

  describe("setupLifecycleListeners", () => {
    it("should register listeners for installation broadcasts", async () => {
      await pluginManager.setupLifecycleListeners();

      // Spy on loadSinglePlugin and make it a no-op to avoid actual import
      const loadSpy = spyOn(
        pluginManager,
        "loadSinglePlugin"
      ).mockImplementation(async () => {});
      await mockEventBus._triggerBroadcast(
        coreHooks.pluginInstallationRequested,
        {
          pluginId: "broadcast-plugin",
          pluginPath: "/broadcast/path",
        }
      );

      expect(loadSpy).toHaveBeenCalledWith(
        "broadcast-plugin",
        "/broadcast/path"
      );
    });

    it("should register listeners for deregistration broadcasts", async () => {
      await pluginManager.setupLifecycleListeners();

      // Trigger a broadcast and verify the listener responds
      const deregSpy = spyOn(pluginManager, "deregisterPlugin");
      await mockEventBus._triggerBroadcast(
        coreHooks.pluginDeregistrationRequested,
        {
          pluginId: "broadcast-plugin",
          deleteSchema: true,
        }
      );

      expect(deregSpy).toHaveBeenCalledWith("broadcast-plugin", {
        deleteSchema: true,
      });
    });
  });

  describe("loadSinglePlugin", () => {
    it("should emit pluginInstalling local hook", async () => {
      // Try loading - will fail import but should still emit installing hook
      try {
        await pluginManager.loadSinglePlugin(
          "nonexistent-plugin",
          "/nonexistent/path"
        );
      } catch {
        // Expected to fail since plugin doesn't exist
      }

      // Should have emitted pluginInstalling locally
      expect(mockEventBus._localEmittedEvents).toContainEqual({
        hook: coreHooks.pluginInstalling.id,
        payload: { pluginId: "nonexistent-plugin" },
      });
    });

    it("should call installer if import fails", async () => {
      try {
        await pluginManager.loadSinglePlugin(
          "test-remote-plugin",
          "/nonexistent/path"
        );
      } catch {
        // Expected to fail at the final import, but installer should be called
      }

      // Installer should have been called when imports failed
      expect(mockInstaller._installCalls).toContain("test-remote-plugin");
    });
  });

  describe("deregisterPlugin", () => {
    beforeEach(() => {
      // Setup cleanup handlers for a plugin
      const cleanupHandlers = (pluginManager as never)[
        "cleanupHandlers"
      ] as Map<string, (() => Promise<void>)[]>;
      cleanupHandlers.set("test-plugin", [async () => {}]);
    });

    it("should emit pluginDeregistering local hook", async () => {
      await pluginManager.deregisterPlugin("test-plugin", {
        deleteSchema: false,
      });

      const deregisteringEvent = mockEventBus._localEmittedEvents.find(
        (e) => e.hook === coreHooks.pluginDeregistering.id
      );
      expect(deregisteringEvent).toBeDefined();
      expect(deregisteringEvent?.payload).toMatchObject({
        pluginId: "test-plugin",
      });
    });

    it("should emit pluginDeregistered after cleanup", async () => {
      await pluginManager.deregisterPlugin("test-plugin", {
        deleteSchema: false,
      });

      const deregisteredEvent = mockEventBus._emittedEvents.find(
        (e) => e.hook === coreHooks.pluginDeregistered.id
      );
      expect(deregisteredEvent).toBeDefined();
      expect(deregisteredEvent?.payload).toMatchObject({
        pluginId: "test-plugin",
      });
    });

    it("should run cleanup handlers in reverse order", async () => {
      const callOrder: number[] = [];
      const cleanupHandlers = (pluginManager as never)[
        "cleanupHandlers"
      ] as Map<string, (() => Promise<void>)[]>;

      cleanupHandlers.set("test-plugin", [
        async () => {
          callOrder.push(1);
        },
        async () => {
          callOrder.push(2);
        },
        async () => {
          callOrder.push(3);
        },
      ]);

      await pluginManager.deregisterPlugin("test-plugin", {
        deleteSchema: false,
      });

      expect(callOrder).toEqual([3, 2, 1]);
    });

    it("should remove plugin router", async () => {
      const pluginRpcRouters = (pluginManager as never)[
        "pluginRpcRouters"
      ] as Map<string, unknown>;
      pluginRpcRouters.set("test-plugin", { mockRouter: true });

      await pluginManager.deregisterPlugin("test-plugin", {
        deleteSchema: false,
      });

      expect(pluginRpcRouters.has("test-plugin")).toBe(false);
    });

    it("should clear permissions for plugin", async () => {
      const registeredPermissions = (pluginManager as never)[
        "registeredPermissions"
      ] as { pluginId: string; id: string }[];

      // Clear existing permissions first
      while (registeredPermissions.length > 0) {
        registeredPermissions.pop();
      }

      // Add test permissions
      registeredPermissions.push(
        { pluginId: "test-plugin", id: "test-plugin.perm1" },
        { pluginId: "test-plugin", id: "test-plugin.perm2" },
        { pluginId: "other-plugin", id: "other-plugin.perm1" }
      );

      await pluginManager.deregisterPlugin("test-plugin", {
        deleteSchema: false,
      });

      // Use getAllPermissions() which returns the current array
      const remaining = pluginManager.getAllPermissions();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe("other-plugin.perm1");
    });
  });

  describe("registerCoreRouter", () => {
    it("should add router to pluginRpcRouters", () => {
      const mockRouter = { test: true };

      pluginManager.registerCoreRouter("admin", mockRouter);

      const pluginRpcRouters = (pluginManager as never)[
        "pluginRpcRouters"
      ] as Map<string, unknown>;
      expect(pluginRpcRouters.get("admin")).toBe(mockRouter);
    });
  });
});
