import { describe, it, expect, beforeEach } from "bun:test";
import { z } from "zod";
import { CacheManagerImpl } from "./cache-manager";
import { CachePluginRegistryImpl } from "./cache-plugin-registry";
import type { CachePlugin, CacheProvider, CacheStats } from "@checkstack/cache-api";
import type { ConfigService, Logger } from "@checkstack/backend-api";
import { createMockLogger } from "@checkstack/test-utils-backend";

class FakeInMemoryCache implements CacheProvider {
  store = new Map<string, unknown>();
  hits = 0;
  misses = 0;

  async get<T>(key: string): Promise<T | undefined> {
    if (this.store.has(key)) {
      this.hits++;
      return this.store.get(key) as T;
    }
    this.misses++;
    return undefined;
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.store.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
  async deleteByPrefix(): Promise<number> {
    return 0;
  }
  async has(key: string): Promise<boolean> {
    return this.store.has(key);
  }
  async getStats(): Promise<CacheStats> {
    return {
      keyCount: this.store.size,
      sizeBytes: null,
      hits: this.hits,
      misses: this.misses,
      scope: "instance",
    };
  }
}

const memoryConfigSchema = z.record(z.string(), z.unknown());

const createMemoryPlugin = (
  factory: () => FakeInMemoryCache,
): CachePlugin<unknown> => ({
  id: "memory",
  displayName: "Memory",
  configVersion: 1,
  configSchema: memoryConfigSchema,
  createProvider: () => factory(),
});

class StubConfigService implements ConfigService {
  store = new Map<string, unknown>();
  async set<T>(configId: string, _s: unknown, _v: number, data: T) {
    this.store.set(configId, data);
  }
  async get<T>(configId: string): Promise<T | undefined> {
    return this.store.get(configId) as T | undefined;
  }
  async getRedacted<T>(configId: string): Promise<Partial<T> | undefined> {
    return this.store.get(configId) as Partial<T> | undefined;
  }
  async delete(configId: string): Promise<void> {
    this.store.delete(configId);
  }
  async list(): Promise<string[]> {
    return [...this.store.keys()];
  }
}

describe("CacheManagerImpl provider proxy", () => {
  let registry: CachePluginRegistryImpl;
  let configService: StubConfigService;
  let logger: Logger;
  let manager: CacheManagerImpl;
  let instances: FakeInMemoryCache[];

  beforeEach(() => {
    registry = new CachePluginRegistryImpl();
    configService = new StubConfigService();
    logger = createMockLogger() as unknown as Logger;
    instances = [];
    registry.register(
      createMemoryPlugin(() => {
        const inst = new FakeInMemoryCache();
        instances.push(inst);
        return inst;
      }),
    );
    manager = new CacheManagerImpl(registry, configService, logger);
  });

  it("returns the same proxy reference across calls", async () => {
    const a = manager.getProvider();
    const b = manager.getProvider();
    expect(a).toBe(b);
  });

  it("delegates writes to the active provider after loadConfiguration", async () => {
    const provider = manager.getProvider();
    await manager.loadConfiguration();
    await provider.set("foo", "bar");
    expect(instances[0].store.get("foo")).toBe("bar");
  });

  it("keeps a captured proxy reference live across setActiveBackend", async () => {
    await manager.loadConfiguration();
    const captured = manager.getProvider();
    await captured.set("before", 1);

    await manager.setActiveBackend("memory", {
      maxEntries: 5000,
      sweepIntervalMs: 30_000,
    });

    // The captured reference must now write to the NEW active provider,
    // not the orphaned old one.
    await captured.set("after", 2);

    const oldInstance = instances[0];
    const newInstance = instances.at(-1)!;
    expect(oldInstance).not.toBe(newInstance);
    expect(oldInstance.store.has("after")).toBe(false);
    expect(newInstance.store.has("after")).toBe(true);
  });

  it("getStats reads from the currently active provider", async () => {
    await manager.loadConfiguration();
    const provider = manager.getProvider();
    await provider.set("k1", "v1");
    await provider.get("k1"); // hit
    await provider.get("missing"); // miss

    const stats = await provider.getStats!();
    expect(stats.keyCount).toBe(1);
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
  });

  it("getStats returns all-null when active provider has no getStats impl", async () => {
    // Plugin whose provider doesn't implement getStats.
    const minimalPlugin: CachePlugin<unknown> = {
      id: "noStats",
      displayName: "No stats",
      configVersion: 1,
      configSchema: memoryConfigSchema,
      createProvider: (): CacheProvider => ({
        get: async () => undefined,
        set: async () => {},
        delete: async () => {},
        deleteByPrefix: async () => 0,
        has: async () => false,
      }),
    };
    registry.register(minimalPlugin);

    await manager.setActiveBackend("noStats", {});
    const stats = await manager.getProvider().getStats!();
    expect(stats).toEqual({
      keyCount: null,
      sizeBytes: null,
      hits: null,
      misses: null,
      scope: "instance",
    });
  });
});
