import { describe, it, expect } from "bun:test";
import type { CachedScope } from "@checkstack/cache-utils";
import {
  createIngestAuthenticator,
  ingestTokenCacheKey,
  ingestTokenMissKey,
} from "@checkstack/ingest-utils";
import type {
  PushTokenVerifier,
  PushTokenLookupResult,
} from "@checkstack/telemetry-backend";
import type { SourceBinding } from "@checkstack/telemetry-common";
import { tokenKit } from "../token-crypto";
import {
  tracestreamPushSourceType,
  TRACESTREAM_PUSH_SOURCE_TYPE_ID,
  TRACESTREAM_PUSH_LOCAL_ID,
} from "./push-source-type";
import { createTracestreamPushTokenLookup } from "./token-lookup";
import { applyPushTokenInvalidation } from "./setup";

/**
 * In-memory CachedScope exposing only the `provider` the ingest authenticator
 * uses. TTL-agnostic (these tests don't advance a clock); good enough to observe
 * positive/negative key writes + deletes.
 */
function memoryCache(): CachedScope {
  const store = new Map<string, unknown>();
  const provider = {
    get: async <T>(key: string): Promise<T | undefined> =>
      store.get(key) as T | undefined,
    set: async (key: string, value: unknown) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    deleteByPrefix: async () => 0,
    has: async (key: string) => store.has(key),
  };
  return { provider } as unknown as CachedScope;
}

/**
 * A fake platform push-token verifier keyed on the token HASH. It enforces the
 * SAME type-scoping the real verifier does (a lookup for another `sourceTypeId`
 * returns null), so this proves `createTracestreamPushTokenLookup` passes the
 * `tracestream.push` scope through.
 */
function fakeVerifier(): {
  verifier: PushTokenVerifier;
  set(hash: string, result: PushTokenLookupResult | null): void;
  seen: string[];
} {
  const rows = new Map<string, PushTokenLookupResult | null>();
  const seen: string[] = [];
  const verifier: PushTokenVerifier = {
    async lookupPushToken({ sourceTypeId, tokenHash }) {
      if (sourceTypeId !== TRACESTREAM_PUSH_SOURCE_TYPE_ID) return null;
      return rows.get(tokenHash) ?? null;
    },
    async recordPushSeen(sourceId) {
      seen.push(sourceId);
    },
  };
  return { verifier, set: (hash, result) => rows.set(hash, result), seen };
}

const tracesBinding = (streamId: string): SourceBinding => ({
  signal: "traces",
  streamId,
});

function mint(streamId: string): { secret: string; tokenHash: string } {
  const g = tokenKit.generateToken({ resourceId: streamId });
  return { secret: g.secret, tokenHash: g.tokenHash };
}

describe("tracestreamPushSourceType", () => {
  it("declares the push seam the migration + UI depend on", () => {
    expect(TRACESTREAM_PUSH_LOCAL_ID).toBe("push");
    // MUST match the literal telemetry migration 0002 promoted legacy tokens to.
    expect(TRACESTREAM_PUSH_SOURCE_TYPE_ID).toBe("tracestream.push");
    expect(tracestreamPushSourceType.id).toBe("push");
    expect(tracestreamPushSourceType.displayName).toBe("Push (OTLP / native)");
    expect(tracestreamPushSourceType.signals).toEqual(["traces"]);
    // Empty config: the token + binding are the instance's entire state.
    expect(tracestreamPushSourceType.configSchema.safeParse({}).success).toBe(true);
    expect(tracestreamPushSourceType.push?.tokenPrefix).toBe("cktr_");
    expect(tracestreamPushSourceType.push?.endpoints).toEqual([
      { kind: "otlp", path: "/api/tracestream/v1/traces", label: "OTLP traces" },
      { kind: "native", path: "/api/tracestream/ingest", label: "Native JSON" },
    ]);
  });
});

describe("createTracestreamPushTokenLookup verify parity", () => {
  it("resolves an enabled traces-bound token to its stream id", async () => {
    const { verifier, set } = fakeVerifier();
    const { secret, tokenHash } = mint("stream-1");
    set(tokenHash, {
      sourceId: "src-1",
      bindings: [tracesBinding("stream-1")],
      enabled: true,
      revoked: false,
    });
    const auth = createIngestAuthenticator({
      lookup: createTracestreamPushTokenLookup({ verifier }),
      cache: memoryCache(),
      hashToken: tokenKit.hashToken,
    });

    const verdict = await auth.verify(secret);
    expect(verdict).toEqual({ ok: true, resourceId: "stream-1", tokenId: "src-1" });
  });

  it("treats a disabled instance as revoked, not unknown", async () => {
    const { verifier, set } = fakeVerifier();
    const { secret, tokenHash } = mint("stream-1");
    set(tokenHash, {
      sourceId: "src-1",
      bindings: [tracesBinding("stream-1")],
      enabled: false,
      revoked: true,
    });
    const auth = createIngestAuthenticator({
      lookup: createTracestreamPushTokenLookup({ verifier }),
      cache: memoryCache(),
      hashToken: tokenKit.hashToken,
    });

    expect(await auth.verify(secret)).toEqual({ ok: false, reason: "revoked" });
  });

  it("treats an enabled instance without a traces binding as revoked", async () => {
    const { verifier, set } = fakeVerifier();
    const { secret, tokenHash } = mint("stream-1");
    set(tokenHash, {
      sourceId: "src-1",
      // Bound for metrics only: real token, but does not route this endpoint.
      bindings: [{ signal: "metrics", streamId: "m-1" }],
      enabled: true,
      revoked: false,
    });
    const auth = createIngestAuthenticator({
      lookup: createTracestreamPushTokenLookup({ verifier }),
      cache: memoryCache(),
      hashToken: tokenKit.hashToken,
    });

    expect(await auth.verify(secret)).toEqual({ ok: false, reason: "revoked" });
  });

  it("rejects an unknown token", async () => {
    const { verifier } = fakeVerifier();
    const { secret } = mint("stream-1");
    const auth = createIngestAuthenticator({
      lookup: createTracestreamPushTokenLookup({ verifier }),
      cache: memoryCache(),
      hashToken: tokenKit.hashToken,
    });

    expect(await auth.verify(secret)).toEqual({ ok: false, reason: "unknown" });
  });
});

describe("applyPushTokenInvalidation", () => {
  it("minted clears the negative shadow so a freshly-minted token authenticates immediately", async () => {
    // The previously-missing case: without the invalidation subscription, a
    // token minted while its hash sits in this pod's negative LRU would keep
    // rejecting until the negative TTL elapsed.
    const { verifier, set } = fakeVerifier();
    const { secret, tokenHash } = mint("stream-1");
    const cache = memoryCache();
    const auth = createIngestAuthenticator({
      lookup: createTracestreamPushTokenLookup({ verifier }),
      cache,
      hashToken: tokenKit.hashToken,
    });

    // 1) Unknown -> negative LRU + shared miss marker recorded.
    expect(await auth.verify(secret)).toEqual({ ok: false, reason: "unknown" });

    // 2) The platform mints the token (row appears) and broadcasts "minted".
    set(tokenHash, {
      sourceId: "src-1",
      bindings: [tracesBinding("stream-1")],
      enabled: true,
      revoked: false,
    });
    await applyPushTokenInvalidation({
      payload: {
        sourceTypeId: TRACESTREAM_PUSH_SOURCE_TYPE_ID,
        sourceId: "src-1",
        tokenHash,
        reason: "minted",
      },
      auth,
      cache,
    });

    // 3) Without the negative-shadow clear this would still be unknown.
    expect(await auth.verify(secret)).toEqual({
      ok: true,
      resourceId: "stream-1",
      tokenId: "src-1",
    });
  });

  it("revoked evicts the shared positive verdict so the token stops authenticating", async () => {
    const { verifier, set } = fakeVerifier();
    const { secret, tokenHash } = mint("stream-1");
    const cache = memoryCache();
    const auth = createIngestAuthenticator({
      lookup: createTracestreamPushTokenLookup({ verifier }),
      cache,
      hashToken: tokenKit.hashToken,
    });

    set(tokenHash, {
      sourceId: "src-1",
      bindings: [tracesBinding("stream-1")],
      enabled: true,
      revoked: false,
    });
    // Warm the positive verdict into the shared cache.
    expect((await auth.verify(secret)).ok).toBe(true);
    expect(await cache.provider.get(ingestTokenCacheKey(tokenHash))).toBeDefined();

    // Platform revokes: the row flips to revoked AND the broadcast lands.
    set(tokenHash, {
      sourceId: "src-1",
      bindings: [tracesBinding("stream-1")],
      enabled: false,
      revoked: true,
    });
    await applyPushTokenInvalidation({
      payload: {
        sourceTypeId: TRACESTREAM_PUSH_SOURCE_TYPE_ID,
        sourceId: "src-1",
        tokenHash,
        reason: "revoked",
      },
      auth,
      cache,
    });

    // Positive key evicted -> re-query hits the now-revoked row.
    expect(await cache.provider.get(ingestTokenCacheKey(tokenHash))).toBeUndefined();
    expect(await cache.provider.get(ingestTokenMissKey(tokenHash))).toBeUndefined();
    expect(await auth.verify(secret)).toEqual({ ok: false, reason: "revoked" });
  });
});
