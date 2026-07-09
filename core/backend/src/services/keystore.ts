import { generateKeyPair, exportJWK, importJWK, type JWK } from "jose";
import { db, lockPool } from "../db";
import { jwtKeys } from "../schema";
import { eq, and, isNull, desc, lt } from "drizzle-orm";
import { rootLogger } from "../logger";
import { createAdvisoryLockService } from "@checkstack/backend-api";

const logger = rootLogger.child({ service: "KeyStore" });

const ALG = "RS256";
const ROTATION_INTERVAL_MS = 1000 * 60 * 60; // 1 hour
const ROTATION_GRACE_PERIOD_MS = 1000 * 60 * 60 * 24; // 24 hours

/**
 * Per-pod in-process cache TTLs. Before this, `getPublicJWKS` (every token
 * verify) and `getSigningKey` (every service-to-service token mint) hit the DB
 * on EVERY request - the two highest-call-count queries in production (~1.6M
 * each). The signing key is valid for at least the 1h rotation interval, so a
 * few-minute cache is always still valid; the JWKS only grows during the grace
 * period, so a short TTL plus a forced refresh on an unknown `kid` (see
 * `jwtService.verify`) keeps a key freshly rotated on another pod from being
 * rejected.
 */
const SIGNING_KEY_TTL_MS = 1000 * 60 * 5; // 5 minutes
const JWKS_TTL_MS = 1000 * 60; // 60 seconds

/** Advisory-lock key serializing rotation across all pods. */
const ROTATION_LOCK_KEY = "core.keystore.rotate";

/** The private key material `importJWK` yields, as `SignJWT.sign` consumes it. */
type PrivateKeyLike = Awaited<ReturnType<typeof importJWK>>;

/** A persisted `jwt_keys` row (the columns the keystore reads/writes). */
export interface JwtKeyRecord {
  id: string;
  publicKey: string;
  privateKey: string;
  algorithm: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

/**
 * Storage seam for the keystore. The default implementation is Drizzle over the
 * admin pool; tests inject an in-memory fake so the caching / rotation
 * orchestration is verifiable without a database or real crypto.
 */
export interface KeyStoreStore {
  /** Newest non-revoked, non-expired key (the current signing key), if any. */
  readActiveKey(): Promise<JwtKeyRecord | undefined>;
  readById(id: string): Promise<JwtKeyRecord | undefined>;
  /** The `public_key` JSON of every non-revoked key (JWKS grace set). */
  readPublicKeys(): Promise<string[]>;
  insertKey(record: JwtKeyRecord): Promise<void>;
  /**
   * Set `expires_at` on EVERY currently-active (non-revoked, `expires_at IS
   * NULL`) key. Used at rotation so orphaned keys become prunable.
   */
  expireActiveKeys(expiresAtIso: string): Promise<void>;
  /** Delete keys whose `expires_at` is set and already in the past. */
  deleteExpired(nowIso: string): Promise<void>;
}

/** Freshly-minted key material (serialized JWK strings + its kid). */
export interface KeyMaterial {
  kid: string;
  publicJwk: string;
  privateJwk: string;
}

export interface KeyStoreDeps {
  store: KeyStoreStore;
  advisoryLock: {
    withXactLock<T>(args: { key: string; fn: () => Promise<T> }): Promise<T>;
  };
  now: () => number;
  generateKeyMaterial: () => Promise<KeyMaterial>;
  importPrivateKey: (privateJwkJson: string) => Promise<PrivateKeyLike>;
}

interface CachedSigningKey {
  kid: string;
  key: PrivateKeyLike;
  cachedAt: number;
}

interface CachedJwks {
  keys: JWK[];
  cachedAt: number;
}

/** Default key generation: a fresh RS256 pair exported as JWK strings. */
async function joseGenerateKeyMaterial(): Promise<KeyMaterial> {
  logger.info("Generating new JWKS key pair...");
  const { publicKey, privateKey } = await generateKeyPair(ALG, {
    extractable: true,
  });
  const publicJwk = await exportJWK(publicKey);
  const privateJwk = await exportJWK(privateKey);
  const kid = crypto.randomUUID();
  for (const jwk of [publicJwk, privateJwk]) {
    jwk.kid = kid;
    jwk.use = "sig";
    jwk.alg = ALG;
  }
  return {
    kid,
    publicJwk: JSON.stringify(publicJwk),
    privateJwk: JSON.stringify(privateJwk),
  };
}

/** Drizzle-backed {@link KeyStoreStore} over the shared admin pool. */
export function createDrizzleKeyStore(): KeyStoreStore {
  return {
    async readActiveKey() {
      const [row] = await db
        .select()
        .from(jwtKeys)
        .where(and(isNull(jwtKeys.revokedAt), isNull(jwtKeys.expiresAt)))
        .orderBy(desc(jwtKeys.createdAt))
        .limit(1);
      return row;
    },
    async readById(id) {
      const [row] = await db.select().from(jwtKeys).where(eq(jwtKeys.id, id));
      return row;
    },
    async readPublicKeys() {
      const rows = await db
        .select({ publicKey: jwtKeys.publicKey })
        .from(jwtKeys)
        .where(isNull(jwtKeys.revokedAt));
      return rows.map((r) => r.publicKey);
    },
    async insertKey(record) {
      await db.insert(jwtKeys).values(record);
    },
    async expireActiveKeys(expiresAtIso) {
      await db
        .update(jwtKeys)
        .set({ expiresAt: expiresAtIso })
        .where(and(isNull(jwtKeys.revokedAt), isNull(jwtKeys.expiresAt)));
    },
    async deleteExpired(nowIso) {
      await db.delete(jwtKeys).where(lt(jwtKeys.expiresAt, nowIso));
    },
  };
}

/** Build the production dependency set (Drizzle + advisory lock + jose). */
function defaultDeps(): KeyStoreDeps {
  return {
    store: createDrizzleKeyStore(),
    advisoryLock: createAdvisoryLockService(lockPool),
    now: () => Date.now(),
    generateKeyMaterial: joseGenerateKeyMaterial,
    importPrivateKey: (json) =>
      // The value is a JWK we serialized ourselves in generateKeyMaterial, so
      // the parse is always a JWK (it never comes from user input).
      importPrivateJwk(JSON.parse(json) as JWK),
  };
}

function importPrivateJwk(jwk: JWK): Promise<PrivateKeyLike> {
  return importJWK(jwk, ALG);
}

export class KeyStore {
  private readonly deps: KeyStoreDeps;
  private signingKeyCache?: CachedSigningKey;
  private signingKeyInflight?: Promise<CachedSigningKey>;
  private jwksCache?: CachedJwks;
  private jwksInflight?: Promise<CachedJwks>;

  constructor(deps: KeyStoreDeps = defaultDeps()) {
    this.deps = deps;
  }

  /** True when a key is older than the rotation interval. */
  private isStale(record: { createdAt: string }): boolean {
    return (
      this.deps.now() - new Date(record.createdAt).getTime() >
      ROTATION_INTERVAL_MS
    );
  }

  /**
   * Current signing key, minting/rotating one when necessary. Served from a
   * per-pod cache; concurrent misses share ONE refresh (single-flight) so a TTL
   * expiry can never stampede the DB.
   */
  async getSigningKey(): Promise<{ kid: string; key: PrivateKeyLike }> {
    const cached = this.signingKeyCache;
    if (cached && this.deps.now() - cached.cachedAt < SIGNING_KEY_TTL_MS) {
      return { kid: cached.kid, key: cached.key };
    }
    this.signingKeyInflight ??= this.refreshSigningKey().finally(() => {
      this.signingKeyInflight = undefined;
    });
    const fresh = await this.signingKeyInflight;
    return { kid: fresh.kid, key: fresh.key };
  }

  private async refreshSigningKey(): Promise<CachedSigningKey> {
    let active = await this.deps.store.readActiveKey();
    if (!active || this.isStale(active)) {
      active = await this.rotate();
    }
    const key = await this.deps.importPrivateKey(active.privateKey);
    const entry: CachedSigningKey = {
      kid: active.id,
      key,
      cachedAt: this.deps.now(),
    };
    this.signingKeyCache = entry;
    return entry;
  }

  /**
   * Mint a new signing key under a cross-pod advisory lock. Double-checked: if
   * another pod rotated while we blocked on the lock, the freshly-read active
   * key is no longer stale and we adopt it instead of minting a duplicate.
   */
  private async rotate(): Promise<JwtKeyRecord> {
    return this.deps.advisoryLock.withXactLock({
      key: ROTATION_LOCK_KEY,
      fn: async () => {
        const active = await this.deps.store.readActiveKey();
        if (active && !this.isStale(active)) return active;

        // Expire EVERY currently-active (non-revoked, expires_at IS NULL) key -
        // not just the one we observed - before minting the new one. Rotation
        // used to expire only the single observed key, so any key orphaned by a
        // pre-lock multi-pod race kept expires_at = NULL forever: it could never
        // be pruned and was returned on every JWKS read (the ~408-rows-per-call
        // growth). Expiring all of them with the grace period lets deleteExpired
        // eventually reclaim them.
        const expiresAt = new Date(
          this.deps.now() + ROTATION_GRACE_PERIOD_MS,
        ).toISOString();
        await this.deps.store.expireActiveKeys(expiresAt);

        const kid = await this.mintKey();
        await this.deps.store.deleteExpired(new Date(this.deps.now()).toISOString());
        // This pod just changed the key set - drop its caches so the next read
        // reflects the new signing key / JWKS immediately.
        this.invalidateCaches();

        const created = await this.deps.store.readById(kid);
        if (!created) {
          throw new Error("Failed to read freshly generated signing key");
        }
        return created;
      },
    });
  }

  private async mintKey(): Promise<string> {
    const { kid, publicJwk, privateJwk } = await this.deps.generateKeyMaterial();
    await this.deps.store.insertKey({
      id: kid,
      publicKey: publicJwk,
      privateKey: privateJwk,
      algorithm: ALG,
      createdAt: new Date(this.deps.now()).toISOString(),
      expiresAt: null,
      revokedAt: null,
    });
    return kid;
  }

  /**
   * Public keys in JWKS format, served from a per-pod cache. `forceRefresh`
   * bypasses the cache - used by verify when a token's `kid` is absent from the
   * cached set (a key just rotated on another pod).
   */
  async getPublicJWKS(opts?: { forceRefresh?: boolean }): Promise<{
    keys: JWK[];
  }> {
    const cached = this.jwksCache;
    if (
      !opts?.forceRefresh &&
      cached &&
      this.deps.now() - cached.cachedAt < JWKS_TTL_MS
    ) {
      return { keys: cached.keys };
    }
    this.jwksInflight ??= this.refreshJwks().finally(() => {
      this.jwksInflight = undefined;
    });
    const fresh = await this.jwksInflight;
    return { keys: fresh.keys };
  }

  private async refreshJwks(): Promise<CachedJwks> {
    const raw = await this.deps.store.readPublicKeys();
    // Each entry is a JWK we serialized ourselves in mintKey, so the parse is
    // always a JWK (it never comes from user input).
    const keys = raw.map((json) => JSON.parse(json) as JWK);
    const entry: CachedJwks = { keys, cachedAt: this.deps.now() };
    this.jwksCache = entry;
    return entry;
  }

  private invalidateCaches(): void {
    this.signingKeyCache = undefined;
    this.jwksCache = undefined;
  }

  /**
   * Delete keys past their grace period. Retained as a public method so a
   * scheduled sweep can call it; rotation also calls it inline.
   */
  async cleanupKeys(): Promise<void> {
    logger.info("Cleaning up expired JWKS keys...");
    await this.deps.store.deleteExpired(new Date(this.deps.now()).toISOString());
  }
}

export const keyStore = new KeyStore();
