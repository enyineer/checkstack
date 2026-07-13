import { describe, it, expect, mock } from "bun:test";
import type {
  SafeDatabase,
  Logger,
  RpcClient,
  EventBus,
} from "@checkstack/backend-api";
import type { CacheManager, CacheProvider } from "@checkstack/cache-api";
import {
  DEFAULT_LOG_STREAM_CONFIG,
  logstreamResourceTypes,
} from "@checkstack/logstream-common";
import {
  createLogstreamService,
  escapeLikePattern,
  nextCursorFor,
  assembleStreamSummaries,
} from "./service";
import type { Storage } from "../storage";
import * as schema from "../schema";
import {
  logStreams,
  logStreamTokens,
  logEvents,
  logSeverityBuckets,
  logPatternBuckets,
  logSeverityHourly,
  logPatternHourly,
  logPatterns,
  logImportantEvents,
  logStreamActivity,
} from "../schema";
import { hashToken } from "../token-crypto";

// =============================================================================
// Test doubles
// =============================================================================

/** A chainable, awaitable stand-in for a drizzle query builder. */
interface Chain<T> extends PromiseLike<T[]> {
  from: () => Chain<T>;
  where: () => Chain<T>;
  orderBy: () => Chain<T>;
  limit: () => Chain<T>;
  groupBy: () => Chain<T>;
}

function chain<T>(rows: T[]): Chain<T> {
  const c: Chain<T> = {
    from: () => c,
    where: () => c,
    orderBy: () => c,
    limit: () => c,
    groupBy: () => c,
    then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject),
  };
  return c;
}

function mockLogger(): Logger {
  return {
    info: mock(),
    error: mock(),
    warn: mock(),
    debug: mock(),
    child: mock(() => mockLogger()),
  };
}

/** A cache manager whose provider records every `delete(key)`. */
function recordingCacheManager(): { cacheManager: CacheManager; deletedKeys: string[] } {
  const deletedKeys: string[] = [];
  const provider: CacheProvider = {
    get: async () => undefined,
    set: async () => {},
    delete: async (key: string) => {
      deletedKeys.push(key);
    },
    deleteByPrefix: async () => 0,
    has: async () => false,
  };
  const cacheManager = {
    getProvider: () => provider,
  } as unknown as CacheManager;
  return { cacheManager, deletedKeys };
}

const noopStorage = {} as unknown as Storage;

const asDb = (fake: unknown) => fake as unknown as SafeDatabase<typeof schema>;

/** An rpcClient whose auth `deleteObjectRelations` records its input. */
function recordingRpcClient(): {
  rpcClient: RpcClient;
  relationDeletes: Array<{ objectType: string; objectId: string }>;
} {
  const relationDeletes: Array<{ objectType: string; objectId: string }> = [];
  const rpcClient = {
    forPlugin: () => ({
      deleteObjectRelations: async (input: {
        objectType: string;
        objectId: string;
      }) => {
        relationDeletes.push(input);
      },
    }),
  } as unknown as RpcClient;
  return { rpcClient, relationDeletes };
}

// =============================================================================
// Pure helpers
// =============================================================================

describe("escapeLikePattern", () => {
  it("escapes LIKE metacharacters so the term matches literally", () => {
    expect(escapeLikePattern("100%_done")).toBe("100\\%\\_done");
    expect(escapeLikePattern("a\\b")).toBe("a\\\\b");
    expect(escapeLikePattern("plain text")).toBe("plain text");
  });
});

describe("nextCursorFor", () => {
  const evt = (id: string, ts: string) =>
    ({ id, ts: new Date(ts) }) as never;

  it("returns null when the page was not full (end of results)", () => {
    expect(nextCursorFor([evt("1", "2026-01-01T00:00:00Z")], 100)).toBeNull();
  });

  it("returns the last row's (ts, id) when the page was full", () => {
    const events = [
      evt("9", "2026-01-01T00:02:00Z"),
      evt("8", "2026-01-01T00:01:00Z"),
    ];
    expect(nextCursorFor(events, 2)).toEqual({
      ts: new Date("2026-01-01T00:01:00Z"),
      id: "8",
    });
  });
});

describe("assembleStreamSummaries", () => {
  it("sums error/warn across the minute+hourly tiers and zero-fills gaps", () => {
    const lastReceived = new Date("2026-01-02T00:00:00Z");
    const summaries = assembleStreamSummaries({
      streamIds: ["s1", "s2", "s3"],
      activity: [{ streamId: "s1", lastReceivedAt: lastReceived }],
      severity: [
        // s1 minute tier
        { streamId: "s1", band: "error", total: "4" },
        { streamId: "s1", band: "warn", total: "2" },
        // s1 hourly tier (older part of the 24h window) - ADDS to the minute sum
        { streamId: "s1", band: "error", total: "6" },
        // s2 only warns, only in the hourly tier
        { streamId: "s2", band: "warn", total: 5 },
      ],
      patternCounts: [
        { streamId: "s1", count: "12" },
        { streamId: "s2", count: 3 },
      ],
    });

    expect(summaries).toEqual([
      {
        id: "s1",
        lastReceivedAt: lastReceived,
        last24hErrorCount: 10, // 4 (minute) + 6 (hourly)
        last24hWarnCount: 2,
        patternCount: 12,
      },
      {
        id: "s2",
        lastReceivedAt: null,
        last24hErrorCount: 0,
        last24hWarnCount: 5,
        patternCount: 3,
      },
      // s3 has no activity/severity/patterns → all zero, still present.
      {
        id: "s3",
        lastReceivedAt: null,
        last24hErrorCount: 0,
        last24hWarnCount: 0,
        patternCount: 0,
      },
    ]);
  });
});

// =============================================================================
// Token lifecycle
// =============================================================================

describe("mintToken", () => {
  it("returns the full secret once and a token row without any hash", async () => {
    const streamRow = {
      id: "stream-1",
      name: "s",
      description: null,
      config: DEFAULT_LOG_STREAM_CONFIG,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    let insertedValues: Record<string, unknown> | undefined;
    const fakeDb = {
      select: () => ({ from: () => chain([streamRow]) }),
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          insertedValues = v;
          return {
            returning: async () => [
              {
                id: "tok-1",
                streamId: "stream-1",
                name: v.name,
                tokenHash: v.tokenHash,
                tokenPrefix: v.tokenPrefix,
                createdAt: new Date(),
                lastUsedAt: null,
                revokedAt: null,
              },
            ],
          };
        },
      }),
    };
    const { cacheManager, deletedKeys } = recordingCacheManager();
    const service = createLogstreamService({
      db: asDb(fakeDb),
      storage: noopStorage,
      cacheManager,
      logger: mockLogger(),
    });

    const result = await service.mintToken({
      streamId: "stream-1",
      name: "shipper",
    });

    // The secret is a real ckls_ token whose hash is what got persisted.
    expect(result.secret.startsWith("ckls_")).toBe(true);
    expect(insertedValues?.tokenHash).toBe(hashToken(result.secret));
    // The returned token row carries NO secret/hash - only the display prefix.
    expect(result.token).not.toHaveProperty("tokenHash");
    expect(result.token).not.toHaveProperty("secret");
    expect(result.token.tokenPrefix).toBe(result.secret.slice(0, 8));
    // The shared negative miss marker for the new token's hash is invalidated,
    // so the just-minted token is not shadowed by a stale unknown-token entry.
    expect(
      deletedKeys.some((k) =>
        k.includes(`ingest-token-miss:${hashToken(result.secret)}`),
      ),
    ).toBe(true);
  });
});

describe("revokeToken", () => {
  it("stamps revokedAt and invalidates the ingest-token cache entry", async () => {
    const tokenHash = "a".repeat(64);
    let setValues: Record<string, unknown> | undefined;
    const fakeDb = {
      update: () => ({
        set: (v: Record<string, unknown>) => {
          setValues = v;
          return {
            where: () => ({
              returning: async () => [{ tokenHash }],
            }),
          };
        },
      }),
    };
    const { cacheManager, deletedKeys } = recordingCacheManager();
    const service = createLogstreamService({
      db: asDb(fakeDb),
      storage: noopStorage,
      cacheManager,
      logger: mockLogger(),
    });

    await service.revokeToken({ streamId: "stream-1", tokenId: "tok-1" });

    expect(setValues?.revokedAt).toBeInstanceOf(Date);
    // The cache key is the shared `ingest-token:<hash>` convention, plugin-scoped.
    expect(deletedKeys).toHaveLength(1);
    expect(deletedKeys[0]).toContain(`ingest-token:${tokenHash}`);
  });

  it("throws NOT_FOUND when no matching token exists for the stream", async () => {
    const fakeDb = {
      update: () => ({
        set: () => ({ where: () => ({ returning: async () => [] }) }),
      }),
    };
    const { cacheManager } = recordingCacheManager();
    const service = createLogstreamService({
      db: asDb(fakeDb),
      storage: noopStorage,
      cacheManager,
      logger: mockLogger(),
    });
    await expect(
      service.revokeToken({ streamId: "stream-1", tokenId: "missing" }),
    ).rejects.toThrow(/not found/i);
  });
});

// =============================================================================
// Stream update config merge
// =============================================================================

describe("updateStream", () => {
  it("merges a partial config into the existing config", async () => {
    const existing = {
      id: "stream-1",
      name: "orig",
      description: "d",
      config: { ...DEFAULT_LOG_STREAM_CONFIG, infoSampleRate: 0.5 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    let setValues: Record<string, unknown> | undefined;
    const fakeDb = {
      select: () => ({ from: () => chain([existing]) }),
      update: () => ({
        set: (v: Record<string, unknown>) => {
          setValues = v;
          return {
            where: () => ({
              returning: async () => [{ ...existing, ...v }],
            }),
          };
        },
      }),
    };
    const { cacheManager } = recordingCacheManager();
    const service = createLogstreamService({
      db: asDb(fakeDb),
      storage: noopStorage,
      cacheManager,
      logger: mockLogger(),
    });

    const result = await service.updateStream({
      id: "stream-1",
      body: { config: { maxRawPerMinute: 42 } },
    });

    // The unspecified knob (infoSampleRate) is preserved; the new one applied.
    const merged = setValues?.config as { infoSampleRate: number; maxRawPerMinute: number };
    expect(merged.infoSampleRate).toBe(0.5);
    expect(merged.maxRawPerMinute).toBe(42);
    expect(result.config.maxRawPerMinute).toBe(42);
  });
});

// =============================================================================
// Delete cascade
// =============================================================================

describe("deleteStream", () => {
  it("cascades deletes across every stream-scoped table and clears token caches", async () => {
    const deletedTables: unknown[] = [];
    const tx = {
      select: () => ({
        from: (table: unknown) => {
          if (table === logStreamTokens) {
            return chain([{ tokenHash: "h1" }, { tokenHash: "h2" }]);
          }
          if (table === logEvents) {
            // One non-empty batch, then the loop ends (batch < BATCH size).
            return chain([{ eventId: 1 }]);
          }
          return chain([]);
        },
      }),
      delete: (table: unknown) => ({
        where: async () => {
          deletedTables.push(table);
        },
      }),
    };
    const fakeDb = {
      transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    };
    const { cacheManager, deletedKeys } = recordingCacheManager();
    const service = createLogstreamService({
      db: asDb(fakeDb),
      storage: noopStorage,
      cacheManager,
      logger: mockLogger(),
    });

    await service.deleteStream({ id: "stream-1" });

    // Every stream-scoped child table AND the stream row are deleted.
    expect(new Set(deletedTables)).toEqual(
      new Set([
        logEvents,
        logStreamTokens,
        logSeverityBuckets,
        logPatternBuckets,
        logSeverityHourly,
        logPatternHourly,
        logPatterns,
        logImportantEvents,
        logStreamActivity,
        logStreams,
      ]),
    );
    // Both tokens' ingest-auth cache entries are invalidated post-commit.
    expect(deletedKeys.some((k) => k.includes("ingest-token:h1"))).toBe(true);
    expect(deletedKeys.some((k) => k.includes("ingest-token:h2"))).toBe(true);
  });

  it("deletes the stream's team grants via auth after the cascade", async () => {
    const tx = {
      select: () => ({ from: () => chain([]) }),
      delete: () => ({ where: async () => {} }),
    };
    const fakeDb = {
      transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    };
    const { cacheManager } = recordingCacheManager();
    const { rpcClient, relationDeletes } = recordingRpcClient();
    const service = createLogstreamService({
      db: asDb(fakeDb),
      storage: noopStorage,
      cacheManager,
      logger: mockLogger(),
      rpcClient,
    });

    await service.deleteStream({ id: "stream-1" });

    // The stream's ReBAC grants are cleared under the SAME qualified type the
    // access rule keys grants on (logstream.stream), for this stream id.
    expect(relationDeletes).toEqual([
      { objectType: logstreamResourceTypes.stream, objectId: "stream-1" },
    ]);
  });

  it("still deletes the stream when no rpcClient is wired (grant cleanup skipped)", async () => {
    const tx = {
      select: () => ({ from: () => chain([]) }),
      delete: () => ({ where: async () => {} }),
    };
    const fakeDb = {
      transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    };
    const { cacheManager } = recordingCacheManager();
    const logger = mockLogger();
    const service = createLogstreamService({
      db: asDb(fakeDb),
      storage: noopStorage,
      cacheManager,
      logger,
    });

    // No rpcClient: the delete succeeds and the missing-client case is warned.
    await service.deleteStream({ id: "stream-1" });
    expect(logger.warn).toHaveBeenCalled();
  });
});

// =============================================================================
// Search mapping + pagination
// =============================================================================

describe("searchEvents", () => {
  it("maps rows (bigint id → string) and returns a cursor when the page is full", async () => {
    const rows = [
      {
        id: 20,
        streamId: "stream-1",
        ts: new Date("2026-01-01T00:02:00Z"),
        observedAt: new Date("2026-01-01T00:02:00Z"),
        severityNumber: 18,
        severityText: "ERROR",
        band: "error" as const,
        body: "boom",
        attributes: null,
        resource: null,
        patternId: "p1",
        traceId: null,
        spanId: null,
      },
      {
        id: 19,
        streamId: "stream-1",
        ts: new Date("2026-01-01T00:01:00Z"),
        observedAt: new Date("2026-01-01T00:01:00Z"),
        severityNumber: 9,
        severityText: null,
        band: "info" as const,
        body: "hello",
        attributes: null,
        resource: null,
        patternId: null,
        traceId: null,
        spanId: null,
      },
    ];
    const fakeDb = {
      select: () => ({ from: () => chain(rows) }),
    };
    const { cacheManager } = recordingCacheManager();
    const service = createLogstreamService({
      db: asDb(fakeDb),
      storage: noopStorage,
      cacheManager,
      logger: mockLogger(),
    });

    const result = await service.searchEvents({ streamId: "stream-1", limit: 2 });

    expect(result.events.map((e) => e.id)).toEqual(["20", "19"]);
    expect(result.events[0]!.band).toBe("error");
    // Full page (2 rows, limit 2) → a cursor to the last row is returned.
    expect(result.nextCursor).toEqual({
      ts: new Date("2026-01-01T00:01:00Z"),
      id: "19",
    });
  });
});

// =============================================================================
// Token invalidation broadcasts (logstream.tokens.invalidated)
// =============================================================================

/** An EventBus double that records every emit. */
function recordingEventBus(): {
  eventBus: EventBus;
  emitted: Array<{ hookId: string; payload: unknown }>;
} {
  const emitted: Array<{ hookId: string; payload: unknown }> = [];
  const eventBus: EventBus = {
    subscribe: async () => async () => {},
    emit: async (hook, payload) => {
      emitted.push({ hookId: hook.id, payload });
    },
    emitLocal: async (hook, payload) => {
      emitted.push({ hookId: hook.id, payload });
    },
    shutdown: async () => {},
  };
  return { eventBus, emitted };
}

describe("token invalidation broadcasts", () => {
  it("revokeToken broadcasts a revoked payload with the token id and hash", async () => {
    const tokenHash = "b".repeat(64);
    const fakeDb = {
      update: () => ({
        set: () => ({
          where: () => ({ returning: async () => [{ tokenHash }] }),
        }),
      }),
    };
    const { cacheManager } = recordingCacheManager();
    const { eventBus, emitted } = recordingEventBus();
    const service = createLogstreamService({
      db: asDb(fakeDb),
      storage: noopStorage,
      cacheManager,
      logger: mockLogger(),
      eventBus,
    });

    await service.revokeToken({ streamId: "stream-1", tokenId: "tok-9" });

    expect(emitted).toHaveLength(1);
    expect(emitted[0].hookId).toBe("logstream.tokens.invalidated");
    expect(emitted[0].payload).toEqual({
      streamId: "stream-1",
      reason: "revoked",
      tokenIds: ["tok-9"],
      tokenHashes: [tokenHash],
    });
  });

  it("mintToken broadcasts a minted payload so pods clear negative caches", async () => {
    const streamRow = {
      id: "stream-1",
      name: "s",
      description: undefined,
      config: DEFAULT_LOG_STREAM_CONFIG,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const fakeDb = {
      select: () => ({ from: () => chain([streamRow]) }),
      insert: () => ({
        values: (v: Record<string, unknown>) => ({
          returning: async () => [
            {
              id: "tok-new",
              streamId: "stream-1",
              name: v.name,
              tokenHash: v.tokenHash,
              tokenPrefix: v.tokenPrefix,
              createdAt: new Date(),
              lastUsedAt: null,
              revokedAt: null,
            },
          ],
        }),
      }),
    };
    const { cacheManager } = recordingCacheManager();
    const { eventBus, emitted } = recordingEventBus();
    const service = createLogstreamService({
      db: asDb(fakeDb),
      storage: noopStorage,
      cacheManager,
      logger: mockLogger(),
      eventBus,
    });

    const result = await service.mintToken({ streamId: "stream-1", name: "t" });

    expect(emitted).toHaveLength(1);
    expect(emitted[0].payload).toMatchObject({
      streamId: "stream-1",
      reason: "minted",
      tokenHashes: [hashToken(result.secret)],
    });
  });

  it("a failing event bus never fails the mutation (best-effort broadcast)", async () => {
    const tokenHash = "c".repeat(64);
    const fakeDb = {
      update: () => ({
        set: () => ({
          where: () => ({ returning: async () => [{ tokenHash }] }),
        }),
      }),
    };
    const { cacheManager } = recordingCacheManager();
    const failingBus: EventBus = {
      subscribe: async () => async () => {},
      emit: async () => {
        throw new Error("bus down");
      },
      emitLocal: async () => {},
      shutdown: async () => {},
    };
    const logger = mockLogger();
    const service = createLogstreamService({
      db: asDb(fakeDb),
      storage: noopStorage,
      cacheManager,
      logger,
      eventBus: failingBus,
    });

    // Does not throw; the failure is logged and the TTL backstops apply.
    await service.revokeToken({ streamId: "stream-1", tokenId: "tok-1" });
    expect(logger.warn).toHaveBeenCalled();
  });
});
