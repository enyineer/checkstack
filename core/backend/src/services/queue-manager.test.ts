import { describe, test, expect, mock } from "bun:test";
import { z } from "zod";
import type {
  Queue,
  QueuePlugin,
  QueueStats,
  JobSummary,
  ListJobsOptions,
  ListJobsResult,
} from "@checkstack/queue-api";
import type { ConfigService, Logger } from "@checkstack/backend-api";
import { QueueManagerImpl } from "./queue-manager";
import { QueuePluginRegistryImpl } from "./queue-plugin-registry";

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Logger;

/** A configurable in-memory queue implementing the full Queue contract. */
class FakeQueue implements Queue<unknown> {
  testConnection = mock(async () => {});
  stop = mock(async () => {});
  private inFlight: number;
  private stats: QueueStats;
  private jobs: JobSummary[];

  constructor(opts?: {
    inFlight?: number;
    stats?: QueueStats;
    jobs?: JobSummary[];
    connectionFails?: boolean;
  }) {
    this.inFlight = opts?.inFlight ?? 0;
    this.stats = opts?.stats ?? {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      consumerGroups: 0,
      scope: "instance",
    };
    this.jobs = opts?.jobs ?? [];
    if (opts?.connectionFails) {
      this.testConnection = mock(async () => {
        throw new Error("cannot reach backend");
      });
    }
  }

  async enqueue() {
    return "job-id";
  }
  async consume() {}
  async scheduleRecurring() {
    return "job-id";
  }
  async cancelRecurring() {}
  async listRecurringJobs() {
    return [];
  }
  async getRecurringJobDetails() {
    return undefined;
  }
  async getInFlightCount() {
    return this.inFlight;
  }
  async getStats() {
    return this.stats;
  }
  async listJobs(opts: ListJobsOptions): Promise<ListJobsResult> {
    const items = this.jobs.slice(opts.offset, opts.offset + opts.limit);
    return { items, total: this.jobs.length, hasMore: false };
  }
}

function fakePlugin(
  id: string,
  opts?: {
    queueFactory?: () => FakeQueue;
    configSchema?: z.ZodType<unknown>;
  },
): QueuePlugin<unknown> & { created: FakeQueue[] } {
  const created: FakeQueue[] = [];
  return {
    id,
    displayName: id,
    configVersion: 1,
    configSchema: opts?.configSchema ?? z.object({}).passthrough(),
    created,
    createQueue: () => {
      const q = opts?.queueFactory?.() ?? new FakeQueue();
      created.push(q);
      return q;
    },
  };
}

/** Minimal in-memory ConfigService keyed by configId. */
function memoryConfigService(): ConfigService & {
  store: Map<string, unknown>;
} {
  const store = new Map<string, unknown>();
  return {
    store,
    set: async (configId, _schema, _version, data) => {
      store.set(configId, data);
    },
    get: async (configId) => store.get(configId) as never,
    getRedacted: async () => undefined,
    delete: async (configId) => {
      store.delete(configId);
    },
    list: async () => [...store.keys()],
  };
}

function makeManager(plugins: QueuePlugin<unknown>[]) {
  const registry = new QueuePluginRegistryImpl();
  for (const p of plugins) registry.register(p);
  const config = memoryConfigService();
  const manager = new QueueManagerImpl(registry, config, noopLogger);
  return { manager, registry, config };
}

describe("QueuePluginRegistryImpl", () => {
  test("registers and retrieves a plugin by id", () => {
    const registry = new QueuePluginRegistryImpl();
    const p = fakePlugin("memory");
    registry.register(p);
    expect(registry.getPlugin("memory")).toBe(p);
    expect(registry.getPlugin("redis")).toBeUndefined();
    expect(registry.getPlugins()).toEqual([p]);
  });

  test("re-registering the same id overwrites", () => {
    const registry = new QueuePluginRegistryImpl();
    const a = fakePlugin("memory");
    const b = fakePlugin("memory");
    registry.register(a);
    registry.register(b);
    expect(registry.getPlugin("memory")).toBe(b);
    expect(registry.getPlugins()).toHaveLength(1);
  });
});

describe("QueueManagerImpl — defaults", () => {
  test("defaults to the memory plugin with the default config", () => {
    const { manager } = makeManager([fakePlugin("memory")]);
    expect(manager.getActivePlugin()).toBe("memory");
    expect(manager.getActiveConfig()).toEqual({
      concurrency: 10,
      maxQueueSize: 10_000,
    });
  });
});

describe("QueueManagerImpl — getQueue proxy stability", () => {
  test("returns the same stable proxy for the same queue name", () => {
    const { manager } = makeManager([fakePlugin("memory")]);
    const a = manager.getQueue("emails");
    const b = manager.getQueue("emails");
    expect(a).toBe(b);
  });

  test("eagerly initializes the proxy from the memory default plugin", () => {
    const plugin = fakePlugin("memory");
    const { manager } = makeManager([plugin]);
    manager.getQueue("emails");
    // The memory default creates the underlying queue immediately.
    expect(plugin.created).toHaveLength(1);
  });
});

describe("QueueManagerImpl — setActiveBackend (provider selection + lifecycle)", () => {
  test("throws when the target plugin is not registered", async () => {
    const { manager } = makeManager([fakePlugin("memory")]);
    await expect(manager.setActiveBackend("redis", {})).rejects.toThrow(
      /not found/i,
    );
  });

  test("rejects a config that fails the plugin's schema", async () => {
    const strict = fakePlugin("redis", {
      configSchema: z.object({ host: z.string() }),
    });
    const { manager } = makeManager([fakePlugin("memory"), strict]);
    await expect(
      manager.setActiveBackend("redis", { host: 123 }),
    ).rejects.toThrow();
  });

  test("throws (and does not switch) when the connection test fails", async () => {
    const failing = fakePlugin("redis", {
      queueFactory: () => new FakeQueue({ connectionFails: true }),
    });
    const { manager } = makeManager([fakePlugin("memory"), failing]);
    await expect(
      manager.setActiveBackend("redis", {}),
    ).rejects.toThrow(/Failed to connect/i);
    // Stays on the previous backend.
    expect(manager.getActivePlugin()).toBe("memory");
  });

  test("switches provider, persists config + active pointer on success", async () => {
    const redis = fakePlugin("redis");
    const { manager, config } = makeManager([fakePlugin("memory"), redis]);

    const result = await manager.setActiveBackend("redis", { url: "x" });

    expect(result.success).toBe(true);
    expect(manager.getActivePlugin()).toBe("redis");
    expect(manager.getActiveConfig()).toEqual({ url: "x" });
    // Persisted: the plugin config and the active-pointer.
    expect(config.store.get("redis")).toEqual({ url: "x" });
    expect(config.store.get("queue:active")).toMatchObject({
      activePluginId: "redis",
    });
  });

  test("warns when there are in-flight jobs during a switch", async () => {
    const memory = fakePlugin("memory", {
      queueFactory: () => new FakeQueue({ inFlight: 3 }),
    });
    const redis = fakePlugin("redis");
    const { manager } = makeManager([memory, redis]);
    // Create a queue so there is an in-flight count to report.
    manager.getQueue("emails");

    const result = await manager.setActiveBackend("redis", {});
    expect(result.warnings.some((w) => /in-flight/i.test(w))).toBe(true);
  });
});

describe("QueueManagerImpl — getAggregatedStats (scope narrowing)", () => {
  test("sums counts across queues and narrows scope to instance if any queue is instance-scoped", async () => {
    const clusterStats: QueueStats = {
      pending: 1,
      processing: 2,
      completed: 3,
      failed: 4,
      consumerGroups: 1,
      scope: "cluster",
    };
    const instanceStats: QueueStats = {
      pending: 10,
      processing: 0,
      completed: 0,
      failed: 0,
      consumerGroups: 1,
      scope: "instance",
    };
    let call = 0;
    const memory = fakePlugin("memory", {
      queueFactory: () =>
        new FakeQueue({ stats: call++ === 0 ? clusterStats : instanceStats }),
    });
    const { manager } = makeManager([memory]);
    manager.getQueue("a");
    manager.getQueue("b");

    const agg = await manager.getAggregatedStats();
    expect(agg.pending).toBe(11);
    expect(agg.completed).toBe(3);
    // one instance-scoped queue forces the aggregate to "instance".
    expect(agg.scope).toBe("instance");
  });

  test("reports instance scope when no queues exist", async () => {
    const { manager } = makeManager([fakePlugin("memory")]);
    const agg = await manager.getAggregatedStats();
    expect(agg.scope).toBe("instance");
    expect(agg.pending).toBe(0);
  });
});

describe("QueueManagerImpl — listJobs aggregation", () => {
  test("returns empty for a zero limit without touching queues", async () => {
    const { manager } = makeManager([fakePlugin("memory")]);
    manager.getQueue("a");
    const res = await manager.listJobs({ state: "waiting", offset: 0, limit: 0 });
    expect(res).toEqual({ items: [], total: 0, hasMore: false });
  });

  test("merge-sorts completed jobs across queues by finishedAt descending", async () => {
    const older: JobSummary = {
      id: "old",
      state: "completed",
      enqueuedAt: new Date("2026-06-01T00:00:00Z"),
      finishedAt: new Date("2026-06-01T01:00:00Z"),
      attempts: 1,
    };
    const newer: JobSummary = {
      id: "new",
      state: "completed",
      enqueuedAt: new Date("2026-06-02T00:00:00Z"),
      finishedAt: new Date("2026-06-02T01:00:00Z"),
      attempts: 1,
    };
    let call = 0;
    const memory = fakePlugin("memory", {
      queueFactory: () =>
        new FakeQueue({ jobs: call++ === 0 ? [older] : [newer] }),
    });
    const { manager } = makeManager([memory]);
    manager.getQueue("a");
    manager.getQueue("b");

    const res = await manager.listJobs({
      state: "completed",
      offset: 0,
      limit: 10,
    });
    expect(res.items.map((j) => j.id)).toEqual(["new", "old"]);
    expect(res.total).toBe(2);
  });
});

describe("QueueManagerImpl — shutdown", () => {
  test("stops every queue proxy", async () => {
    const queues: FakeQueue[] = [];
    const memory = fakePlugin("memory", {
      queueFactory: () => {
        const q = new FakeQueue();
        queues.push(q);
        return q;
      },
    });
    const { manager } = makeManager([memory]);
    manager.getQueue("a");
    manager.getQueue("b");

    await manager.shutdown();

    expect(queues).toHaveLength(2);
    for (const q of queues) {
      expect(q.stop).toHaveBeenCalled();
    }
  });
});
