import { describe, test, expect } from "bun:test";
import {
  KeyStore,
  type JwtKeyRecord,
  type KeyStoreStore,
  type KeyStoreDeps,
} from "./keystore";

/**
 * Orchestration regression coverage for the keystore's caching + rotation,
 * exercised through an in-memory {@link KeyStoreStore} and a pass-through
 * advisory lock (no DB, no real crypto). Guards the three production defects
 * this refactor fixes:
 *  - per-request DB reads for the JWKS / signing key (now per-pod cached),
 *  - rotation orphaning keys with `expires_at = NULL` forever (now every active
 *    key is expired on rotation, so cleanup can prune them),
 *  - duplicate rotation across pods (double-checked under the lock).
 */

const HOUR = 1000 * 60 * 60;
const BASE = Date.UTC(2026, 0, 1);

function keyRecord(
  id: string,
  createdAtMs: number,
  over: Partial<JwtKeyRecord> = {},
): JwtKeyRecord {
  return {
    id,
    publicKey: JSON.stringify({ kid: id, use: "sig", alg: "RS256" }),
    privateKey: JSON.stringify({ kid: id }),
    algorithm: "RS256",
    createdAt: new Date(createdAtMs).toISOString(),
    expiresAt: null,
    revokedAt: null,
    ...over,
  };
}

function makeFakeStore(seed: JwtKeyRecord[]) {
  const rows: JwtKeyRecord[] = seed.map((r) => ({ ...r }));
  const calls = {
    readActiveKey: 0,
    readById: 0,
    readPublicKeys: 0,
    insertKey: 0,
    expireActiveKeys: 0,
    deleteExpired: 0,
  };
  const store: KeyStoreStore = {
    async readActiveKey() {
      calls.readActiveKey += 1;
      return rows
        .filter((r) => r.revokedAt === null && r.expiresAt === null)
        .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    },
    async readById(id) {
      calls.readById += 1;
      return rows.find((r) => r.id === id);
    },
    async readPublicKeys() {
      calls.readPublicKeys += 1;
      return rows.filter((r) => r.revokedAt === null).map((r) => r.publicKey);
    },
    async insertKey(record) {
      calls.insertKey += 1;
      rows.push({ ...record });
    },
    async expireActiveKeys(expiresAtIso) {
      calls.expireActiveKeys += 1;
      for (const r of rows) {
        if (r.revokedAt === null && r.expiresAt === null) {
          r.expiresAt = expiresAtIso;
        }
      }
    },
    async deleteExpired(nowIso) {
      calls.deleteExpired += 1;
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        const e = rows[i].expiresAt;
        if (e !== null && e < nowIso) rows.splice(i, 1);
      }
    },
  };
  return { store, rows, calls };
}

function makeKeyStore(
  seed: JwtKeyRecord[] = [],
  overrides: Partial<KeyStoreDeps> = {},
) {
  const { store, rows, calls } = makeFakeStore(seed);
  let nowMs = BASE;
  let mintCounter = 0;
  const deps: KeyStoreDeps = {
    store,
    advisoryLock: { withXactLock: ({ fn }) => fn() },
    now: () => nowMs,
    generateKeyMaterial: async () => {
      mintCounter += 1;
      const kid = `minted-${mintCounter}`;
      return {
        kid,
        publicJwk: JSON.stringify({ kid, use: "sig", alg: "RS256" }),
        privateJwk: JSON.stringify({ kid }),
      };
    },
    importPrivateKey: async () => new Uint8Array([1, 2, 3]),
    ...overrides,
  };
  const ks = new KeyStore(deps);
  return { ks, rows, calls, setNow: (ms: number) => (nowMs = ms) };
}

/** The kids of the currently-active (non-revoked, non-expired) keys. */
function activeKids(rows: JwtKeyRecord[]): string[] {
  return rows
    .filter((r) => r.revokedAt === null && r.expiresAt === null)
    .map((r) => r.id);
}

describe("KeyStore.getSigningKey", () => {
  test("mints a signing key when none exists", async () => {
    const { ks, rows, calls } = makeKeyStore();
    const { kid } = await ks.getSigningKey();
    expect(kid).toBe("minted-1");
    expect(calls.insertKey).toBe(1);
    expect(activeKids(rows)).toEqual(["minted-1"]);
  });

  test("serves a fresh key from cache without re-reading the store", async () => {
    const { ks, calls } = makeKeyStore([keyRecord("k-active", BASE)]);
    await ks.getSigningKey();
    const readsAfterFirst = calls.readActiveKey;
    await ks.getSigningKey();
    await ks.getSigningKey();
    // Cache hit: no further store reads, no rotation.
    expect(calls.readActiveKey).toBe(readsAfterFirst);
    expect(calls.insertKey).toBe(0);
    expect(calls.expireActiveKeys).toBe(0);
  });

  test("does NOT rotate when the active key is within the rotation interval", async () => {
    const { ks, calls } = makeKeyStore([keyRecord("k-active", BASE)]);
    const { kid } = await ks.getSigningKey();
    expect(kid).toBe("k-active");
    expect(calls.insertKey).toBe(0);
  });

  test("rotates when the active key is older than the rotation interval", async () => {
    const { ks, rows, calls } = makeKeyStore([
      keyRecord("k-old", BASE - 2 * HOUR),
    ]);
    const { kid } = await ks.getSigningKey();
    expect(kid).toBe("minted-1"); // a fresh key
    expect(calls.insertKey).toBe(1);
    expect(calls.expireActiveKeys).toBe(1);
    // Only the newly minted key is active; the old one now carries an expiry.
    expect(activeKids(rows)).toEqual(["minted-1"]);
    expect(rows.find((r) => r.id === "k-old")?.expiresAt).not.toBeNull();
  });

  test("self-heals: rotation expires EVERY orphaned active key, not just one", async () => {
    // Three keys race-orphaned by pre-lock rotations: all active, all stale.
    const { ks, rows } = makeKeyStore([
      keyRecord("orphan-1", BASE - 3 * HOUR),
      keyRecord("orphan-2", BASE - 3 * HOUR),
      keyRecord("orphan-3", BASE - 2 * HOUR),
    ]);
    await ks.getSigningKey();
    // After rotation exactly ONE key is active (the freshly minted one); all
    // three orphans got an expiry and are now prunable.
    expect(activeKids(rows)).toEqual(["minted-1"]);
    for (const id of ["orphan-1", "orphan-2", "orphan-3"]) {
      expect(rows.find((r) => r.id === id)?.expiresAt).not.toBeNull();
    }
  });

  test("single-flight: concurrent misses mint only once", async () => {
    const { ks, calls } = makeKeyStore();
    const [a, b, c] = await Promise.all([
      ks.getSigningKey(),
      ks.getSigningKey(),
      ks.getSigningKey(),
    ]);
    expect(a.kid).toBe(b.kid);
    expect(b.kid).toBe(c.kid);
    expect(calls.insertKey).toBe(1);
  });

  test("double-checked rotation adopts a key another pod minted under the lock", async () => {
    const seedStale = keyRecord("k-old", BASE - 2 * HOUR);
    let injected = false;
    const { ks, rows, calls } = makeKeyStore([seedStale], {
      advisoryLock: {
        withXactLock: async ({ fn }) => {
          // Simulate another pod rotating while we blocked on the lock: a fresh
          // key appears, and the stale one is expired, before our fn runs.
          if (!injected) {
            injected = true;
            const old = rows.find((r) => r.id === "k-old");
            if (old) old.expiresAt = new Date(BASE + HOUR).toISOString();
            rows.push(keyRecord("other-pod", BASE));
          }
          return fn();
        },
      },
    });
    const { kid } = await ks.getSigningKey();
    // We adopt the other pod's fresh key instead of minting a duplicate.
    expect(kid).toBe("other-pod");
    expect(calls.insertKey).toBe(0);
    expect(calls.expireActiveKeys).toBe(0);
  });
});

describe("KeyStore.getPublicJWKS", () => {
  test("caches the JWKS and forceRefresh bypasses the cache", async () => {
    const { ks, calls } = makeKeyStore([keyRecord("k1", BASE)]);
    const first = await ks.getPublicJWKS();
    expect(first.keys.map((k) => k.kid)).toEqual(["k1"]);
    expect(calls.readPublicKeys).toBe(1);
    // Cache hit.
    await ks.getPublicJWKS();
    expect(calls.readPublicKeys).toBe(1);
    // Forced refresh re-reads.
    await ks.getPublicJWKS({ forceRefresh: true });
    expect(calls.readPublicKeys).toBe(2);
  });

  test("reflects a newly rotated key (rotation invalidates the JWKS cache)", async () => {
    const { ks } = makeKeyStore();
    expect((await ks.getPublicJWKS()).keys).toEqual([]);
    await ks.getSigningKey(); // mints minted-1 and invalidates the cache
    expect((await ks.getPublicJWKS()).keys.map((k) => k.kid)).toEqual([
      "minted-1",
    ]);
  });

  test("excludes revoked keys from the JWKS", async () => {
    const { ks } = makeKeyStore([
      keyRecord("live", BASE),
      keyRecord("dead", BASE, { revokedAt: new Date(BASE).toISOString() }),
    ]);
    expect((await ks.getPublicJWKS()).keys.map((k) => k.kid)).toEqual(["live"]);
  });
});

describe("KeyStore.cleanupKeys", () => {
  test("deletes only keys whose grace period has elapsed", async () => {
    const { ks, rows } = makeKeyStore([
      keyRecord("live", BASE),
      keyRecord("expiring", BASE, {
        expiresAt: new Date(BASE + HOUR).toISOString(), // in the future
      }),
      keyRecord("expired", BASE, {
        expiresAt: new Date(BASE - HOUR).toISOString(), // already elapsed
      }),
    ]);
    await ks.cleanupKeys();
    expect(rows.map((r) => r.id).toSorted()).toEqual(["expiring", "live"]);
  });
});
