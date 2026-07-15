import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { CachedScope } from "@checkstack/cache-utils";
import {
  createIngestAuthenticator,
  createSourceTokenKit,
} from "@checkstack/ingest-utils";
import {
  withTestDb,
  isIntegrationEnabled,
  createMockLogger,
  type TestDb,
} from "@checkstack/test-utils-backend";
import * as schema from "./schema";
import { telemetrySources } from "./schema";
import {
  createPushTokenLookup,
  createPushTokenVerifier,
  PUSH_SEEN_STAMP_THROTTLE_MS,
  type PushTokenLookupResult,
  type PushTokenVerifier,
} from "./push-tokens";

const MIGRATIONS = path.join(import.meta.dir, "..", "drizzle");

const kit = createSourceTokenKit({ prefix: "ckpush_" });

/** A verifier stub returning a fixed lookup result, ignoring the queried hash. */
function fakeVerifier(result: PushTokenLookupResult | null): PushTokenVerifier {
  return {
    lookupPushToken: async () => result,
    recordPushSeen: async () => {},
  };
}

// =============================================================================
// createPushTokenLookup adapter (pure - fake verifier)
// =============================================================================

describe("createPushTokenLookup", () => {
  const sourceTypeId = "metricstream.otlp";

  it("resolves the bound stream id for the signal on the happy path", async () => {
    const lookup = createPushTokenLookup({
      verifier: fakeVerifier({
        sourceId: "src-1",
        bindings: [{ signal: "logs", streamId: "stream-9" }],
        enabled: true,
        revoked: false,
      }),
      sourceTypeId,
      signal: "logs",
    });
    const row = await lookup("hash-abc");
    expect(row).toEqual({
      tokenId: "src-1",
      resourceId: "stream-9",
      tokenHash: "hash-abc",
      revokedAt: null,
    });
  });

  it("returns a revoked row (non-null revokedAt) for a disabled instance", async () => {
    const lookup = createPushTokenLookup({
      verifier: fakeVerifier({
        sourceId: "src-1",
        bindings: [{ signal: "logs", streamId: "stream-9" }],
        enabled: false,
        revoked: true,
      }),
      sourceTypeId,
      signal: "logs",
    });
    const row = await lookup("hash-abc");
    expect(row?.revokedAt).not.toBeNull();
  });

  it("returns a revoked row when the instance has no binding for the signal", async () => {
    const lookup = createPushTokenLookup({
      verifier: fakeVerifier({
        sourceId: "src-1",
        bindings: [{ signal: "metrics", streamId: "m-1" }],
        enabled: true,
        revoked: false,
      }),
      sourceTypeId,
      signal: "logs",
    });
    const row = await lookup("hash-abc");
    // Real token, wrong endpoint signal -> revoked, NOT null (so it is not
    // poisoned into the negative cache).
    expect(row).not.toBeNull();
    expect(row?.revokedAt).not.toBeNull();
  });

  it("returns null for an unknown token (verifier miss)", async () => {
    const lookup = createPushTokenLookup({
      verifier: fakeVerifier(null),
      sourceTypeId,
      signal: "logs",
    });
    expect(await lookup("hash-abc")).toBeNull();
  });
});

// =============================================================================
// The adapter against a REAL IngestAuthenticator
// =============================================================================

/** In-memory CachedScope exposing only the provider the authenticator uses. */
function memoryCache(): CachedScope {
  const store = new Map<string, { value: unknown; expiresAt: number }>();
  const provider = {
    get: async <T>(key: string): Promise<T | undefined> => {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= Date.now()) {
        store.delete(key);
        return undefined;
      }
      return entry.value as T;
    },
    set: async (key: string, value: unknown, ttlMs?: number) => {
      store.set(key, {
        value,
        expiresAt:
          ttlMs !== undefined ? Date.now() + ttlMs : Number.POSITIVE_INFINITY,
      });
    },
    delete: async (key: string) => void store.delete(key),
    deleteByPrefix: async () => 0,
    has: async (key: string) => store.has(key),
  };
  return { provider } as unknown as CachedScope;
}

describe("push-token lookup through createIngestAuthenticator", () => {
  const sourceTypeId = "metricstream.otlp";

  function authFor(result: PushTokenLookupResult | null) {
    return createIngestAuthenticator({
      lookup: createPushTokenLookup({
        verifier: fakeVerifier(result),
        sourceTypeId,
        signal: "logs",
      }),
      cache: memoryCache(),
      hashToken: kit.hashToken,
    });
  }

  it("verifies a valid token and resolves its bound stream", async () => {
    const token = kit.generateToken({ resourceId: "src-1" }).secret;
    const auth = authFor({
      sourceId: "src-1",
      bindings: [{ signal: "logs", streamId: "stream-9" }],
      enabled: true,
      revoked: false,
    });
    expect(await auth.verify(token)).toEqual({
      ok: true,
      resourceId: "stream-9",
      tokenId: "src-1",
    });
  });

  it("rejects a disabled instance's token as revoked", async () => {
    const token = kit.generateToken({ resourceId: "src-1" }).secret;
    const auth = authFor({
      sourceId: "src-1",
      bindings: [{ signal: "logs", streamId: "stream-9" }],
      enabled: false,
      revoked: true,
    });
    expect(await auth.verify(token)).toEqual({ ok: false, reason: "revoked" });
  });

  it("rejects an unknown token", async () => {
    const token = kit.generateToken({ resourceId: "src-1" }).secret;
    const auth = authFor(null);
    expect(await auth.verify(token)).toEqual({ ok: false, reason: "unknown" });
  });
});

// =============================================================================
// createPushTokenVerifier (db-backed - integration)
// =============================================================================

describe.skipIf(!isIntegrationEnabled())("createPushTokenVerifier (integration)", () => {
  let testDb: TestDb<typeof schema>;

  beforeAll(async () => {
    testDb = await withTestDb({ schema, migrationsFolder: MIGRATIONS });
  });
  afterAll(async () => {
    await testDb?.dispose();
  });
  beforeEach(async () => {
    await testDb.db.delete(telemetrySources);
  });

  async function insertPushRow(input: {
    id: string;
    sourceTypeId: string;
    tokenHash: string;
    enabled?: boolean;
    bindings?: { signal: "logs" | "metrics" | "traces"; streamId: string }[];
  }): Promise<void> {
    await testDb.db.insert(telemetrySources).values({
      id: input.id,
      sourceTypeId: input.sourceTypeId,
      name: input.id,
      config: {},
      bindings: input.bindings ?? [{ signal: "logs", streamId: "stream-1" }],
      enabled: input.enabled ?? true,
      pushTokenHash: input.tokenHash,
      pushTokenPrefix: input.tokenHash.slice(0, 8),
    });
  }

  it("resolves a token by hash, scoped to its source type", async () => {
    await insertPushRow({
      id: "a",
      sourceTypeId: "metricstream.otlp",
      tokenHash: "hash-a",
    });
    const verifier = createPushTokenVerifier({
      db: testDb.db,
      logger: createMockLogger(),
    });

    const hit = await verifier.lookupPushToken({
      sourceTypeId: "metricstream.otlp",
      tokenHash: "hash-a",
    });
    expect(hit).toEqual({
      sourceId: "a",
      bindings: [{ signal: "logs", streamId: "stream-1" }],
      enabled: true,
      revoked: false,
    });
  });

  it("does NOT resolve a token for a different source type (type scoping)", async () => {
    await insertPushRow({
      id: "a",
      sourceTypeId: "metricstream.otlp",
      tokenHash: "hash-a",
    });
    const verifier = createPushTokenVerifier({
      db: testDb.db,
      logger: createMockLogger(),
    });
    // Same hash, wrong type -> unknown (null).
    expect(
      await verifier.lookupPushToken({
        sourceTypeId: "logstream.otlp",
        tokenHash: "hash-a",
      }),
    ).toBeNull();
  });

  it("returns null for an unknown hash", async () => {
    const verifier = createPushTokenVerifier({
      db: testDb.db,
      logger: createMockLogger(),
    });
    expect(
      await verifier.lookupPushToken({
        sourceTypeId: "metricstream.otlp",
        tokenHash: "nope",
      }),
    ).toBeNull();
  });

  it("distinguishes a disabled instance (revoked, not unknown)", async () => {
    await insertPushRow({
      id: "a",
      sourceTypeId: "metricstream.otlp",
      tokenHash: "hash-a",
      enabled: false,
    });
    const verifier = createPushTokenVerifier({
      db: testDb.db,
      logger: createMockLogger(),
    });
    const hit = await verifier.lookupPushToken({
      sourceTypeId: "metricstream.otlp",
      tokenHash: "hash-a",
    });
    expect(hit).not.toBeNull();
    expect(hit?.enabled).toBe(false);
    expect(hit?.revoked).toBe(true);
  });

  it("recordPushSeen stamps lastRunAt then throttles within the window", async () => {
    await insertPushRow({
      id: "a",
      sourceTypeId: "metricstream.otlp",
      tokenHash: "hash-a",
    });
    let clock = new Date("2026-01-01T00:00:00.000Z");
    const verifier = createPushTokenVerifier({
      db: testDb.db,
      logger: createMockLogger(),
      now: () => clock,
    });

    await verifier.recordPushSeen("a");
    const afterFirst = await lastRunAt("a");
    expect(afterFirst?.toISOString()).toBe("2026-01-01T00:00:00.000Z");

    // Within the throttle window: no new stamp.
    clock = new Date(clock.getTime() + PUSH_SEEN_STAMP_THROTTLE_MS - 1);
    await verifier.recordPushSeen("a");
    expect((await lastRunAt("a"))?.toISOString()).toBe(
      "2026-01-01T00:00:00.000Z",
    );

    // Past the window: stamps again.
    clock = new Date(clock.getTime() + 2);
    await verifier.recordPushSeen("a");
    expect((await lastRunAt("a"))?.getTime()).toBe(clock.getTime());
  });

  async function lastRunAt(id: string): Promise<Date | null> {
    const [row] = await testDb.db
      .select({ lastRunAt: telemetrySources.lastRunAt })
      .from(telemetrySources)
      .where(eq(telemetrySources.id, id))
      .limit(1);
    return row?.lastRunAt ?? null;
  }
});
