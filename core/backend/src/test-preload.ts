/**
 * Test Preload File
 *
 * This file is loaded BEFORE any test file runs (via bunfig.toml).
 * It ensures mock.module() is called before mocked modules are imported.
 */

import { mock } from "bun:test";
import {
  createMockDbModule,
  createMockLoggerModule,
  createMockLogger,
} from "@checkstack/test-utils-backend";
import { coreServices } from "@checkstack/backend-api";
import path from "node:path";

// Get absolute paths to the modules we need to mock
const backendSrcDir = path.join(__dirname);
const dbPath = path.join(backendSrcDir, "db");
const loggerPath = path.join(backendSrcDir, "logger");
const coreServicesPath = path.join(
  backendSrcDir,
  "plugin-manager",
  "core-services",
);

// Mock database module with absolute path
mock.module(dbPath, () => createMockDbModule());

// Mock logger module with absolute path
mock.module(loggerPath, () => createMockLoggerModule());

/**
 * Mock core-services to register mock factories that DON'T access DATABASE_URL.
 *
 * The real issue: core-services.ts line 79 directly accesses process.env.DATABASE_URL
 * inside the database factory function. This happens at RUNTIME when the factory
 * is called, not at import time. Module mocking can't prevent it.
 *
 * Solution: Provide a mock version of registerCoreServices that registers
 * test-safe factories.
 */
mock.module(coreServicesPath, () => ({
  registerCoreServices: ({
    registry,
    pluginRpcRouters,
    pluginContractRegistry,
  }: {
    registry: {
      registerFactory: (
        ref: { id: string },
        factory: (metadata: { pluginId: string }) => unknown,
      ) => void;
      register: (ref: { id: string }, impl: unknown) => void;
    };
    pluginRpcRouters?: Map<string, unknown>;
    pluginContractRegistry?: Map<string, unknown>;
  }) => {
    // Register mock database factory - includes dialect.migrate for migration tests
    registry.registerFactory(coreServices.database, () => ({
      dialect: {
        migrate: async () => {}, // Mock migrate function
      },
      session: {},
    }));

    // Register mock logger factory
    registry.registerFactory(coreServices.logger, () => createMockLogger());

    // Register mock auth factory
    registry.registerFactory(coreServices.auth, () => ({
      authenticate: async () => {},
      getCredentials: async () => ({ headers: {} }),
      getAnonymousPermissions: async () => [],
      checkResourceTeamAccess: async () => ({ hasAccess: true }),
      getAccessibleResourceIds: async ({
        resourceIds,
      }: {
        resourceIds: string[];
      }) => resourceIds,
    }));

    // Register mock fetch factory
    registry.registerFactory(coreServices.fetch, () => ({
      fetch: async () => new Response(),
      forPlugin: () => ({
        fetch: async () => new Response(),
        get: async () => new Response(),
        post: async () => new Response(),
        put: async () => new Response(),
        patch: async () => new Response(),
        delete: async () => new Response(),
      }),
    }));

    // Register mock RPC client factory
    registry.registerFactory(coreServices.rpcClient, () => ({
      forPlugin: () => ({}),
    }));

    // Register mock health check registry (singleton) - with actual storage
    const strategies = new Map<string, unknown>();
    registry.registerFactory(coreServices.healthCheckRegistry, () => ({
      register: (strategy: { id: string }) => {
        strategies.set(strategy.id, strategy);
      },
      getStrategy: (id: string) => strategies.get(id),
      getAllStrategies: () => [...strategies.values()],
    }));

    // Register mock RPC service factory.
    //
    // This MUST mirror the production factory's router wiring: it keys the
    // router + contract by the resolving plugin's id into the SAME shared
    // maps the API route handler reads. A previous version stubbed
    // `registerRouter` as a no-op, which silently disabled router
    // registration across the entire core/backend test suite — making oRPC
    // router reachability impossible to verify (a 404 looked identical to a
    // wired route to any test that didn't assert hard).
    registry.registerFactory(coreServices.rpc, (metadata) => ({
      registerRouter: (router: unknown, contract: unknown): void => {
        pluginRpcRouters?.set(metadata.pluginId, router);
        pluginContractRegistry?.set(metadata.pluginId, contract);
      },
      registerHttpHandler: () => {},
    }));

    // Register mock config factory
    registry.registerFactory(coreServices.config, () => ({
      get: async () => {},
      set: async () => {},
      delete: async () => {},
    }));

    // Register mock EventBus factory
    registry.registerFactory(coreServices.eventBus, () => ({
      emit: async () => {},
      emitLocal: async () => {},
      // eslint-disable-next-line unicorn/consistent-function-scoping
      subscribe: async () => () => {},
    }));

    // Return the registries object to match actual function signature
    // Create a mock collector registry
    const collectors = new Map<string, unknown>();
    return {
      collectorRegistry: {
        register: (collector: { id: string }) => {
          collectors.set(collector.id, collector);
        },
        getCollector: (id: string) => collectors.get(id),
        getAllCollectors: () => [...collectors.values()],
        unregisterByOwner: () => {},
        unregisterByMissingStrategies: () => {},
      },
    };
  },
}));
