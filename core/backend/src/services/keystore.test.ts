import { describe, it, expect, mock, beforeEach } from "bun:test";
import { KeyStore } from "./keystore";

/**
 * Drizzle fluent-chain mock factory.
 *
 * Drizzle's API returns `this` from every query-builder method (select, from,
 * where, …). The final object is thenable — awaiting it resolves the query.
 * This factory builds a single object that satisfies that pattern without
 * resorting to `any`.
 */
interface DrizzleMockChain {
  insert: ReturnType<typeof mock>;
  values: ReturnType<typeof mock>;
  update: ReturnType<typeof mock>;
  set: ReturnType<typeof mock>;
  delete: ReturnType<typeof mock>;
  select: ReturnType<typeof mock>;
  from: ReturnType<typeof mock>;
  where: ReturnType<typeof mock>;
  orderBy: ReturnType<typeof mock>;
  limit: ReturnType<typeof mock>;
  // eslint-disable-next-line unicorn/no-thenable -- Required: Drizzle chains are awaitable via a custom .then()
  then: (resolve: (rows: unknown[]) => void) => void;
}

function createDrizzleMockChain(): DrizzleMockChain {
  const chain: DrizzleMockChain = {
    insert: mock(() => chain),
    values: mock(() => Promise.resolve()),
    update: mock(() => chain),
    set: mock(() => chain),
    delete: mock(() => chain),
    select: mock(() => chain),
    from: mock(() => chain),
    where: mock(() => chain),
    orderBy: mock(() => chain),
    limit: mock(() => chain),
    // eslint-disable-next-line unicorn/no-thenable -- Required: Drizzle chains are awaitable via a custom .then()
    then: (resolve) => resolve([]),
  };

  return chain;
}

const dbMock = createDrizzleMockChain();

mock.module("../db", () => ({
  db: dbMock,
}));

describe("KeyStore", () => {
  let store: KeyStore;
  let mockKeyForGeneration: Record<string, unknown>;

  beforeEach(async () => {
    store = new KeyStore();

    // Reset mocks
    dbMock.select.mockClear();
    dbMock.insert.mockClear();
    dbMock.update.mockClear();
    dbMock.set.mockClear();
    dbMock.delete.mockClear();
    dbMock.where.mockClear();

    // Reset default behavior — empty result set
    // eslint-disable-next-line unicorn/no-thenable -- Required: Drizzle chains are awaitable via a custom .then()
    dbMock.then = (resolve) => resolve([]);

    // Pre-generate a valid RSA keypair for mock responses
    const { generateKeyPair, exportJWK } = await import("jose");
    const { publicKey, privateKey } = await generateKeyPair("RS256", {
      extractable: true,
    });
    const publicJwk = await exportJWK(publicKey);
    const privateJwk = await exportJWK(privateKey);

    mockKeyForGeneration = {
      id: "generated-kid",
      publicKey: JSON.stringify(publicJwk),
      privateKey: JSON.stringify(privateJwk),
      algorithm: "RS256",
      createdAt: new Date().toISOString(),
      expiresAt: undefined,
      revokedAt: undefined,
    };
  });

  it("should generate a new key if no active key exists", async () => {
    let callCount = 0;
    // eslint-disable-next-line unicorn/no-thenable -- Required: Drizzle chains are awaitable via a custom .then()
    dbMock.then = (resolve) => {
      callCount++;
      if (callCount === 1) {
        return resolve([]); // First call: no active key
      }
      return resolve([mockKeyForGeneration]);
    };

    const result = await store.getSigningKey();

    expect(result.kid).toBe("generated-kid");
    expect(result.key).toBeTruthy();
    expect(dbMock.insert).toHaveBeenCalled();
  });

  it("should return the existing key if it is valid", async () => {
    const { generateKeyPair, exportJWK } = await import("jose");
    const { publicKey, privateKey } = await generateKeyPair("RS256", {
      extractable: true,
    });
    const publicJwk = await exportJWK(publicKey);
    const privateJwk = await exportJWK(privateKey);
    const kid = "test-kid";

    const mockKeyRow = {
      id: kid,
      publicKey: JSON.stringify(publicJwk),
      privateKey: JSON.stringify(privateJwk),
      algorithm: "RS256",
      createdAt: new Date().toISOString(),
      expiresAt: undefined,
      revokedAt: undefined,
    };

    // eslint-disable-next-line unicorn/no-thenable -- Required: Drizzle chains are awaitable via a custom .then()
    dbMock.then = (resolve) => resolve([mockKeyRow]);

    const result = await store.getSigningKey();

    expect(result.kid).toBe(kid);
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it("should rotate key if the existing one is too old", async () => {
    const { generateKeyPair, exportJWK } = await import("jose");
    const { publicKey, privateKey } = await generateKeyPair("RS256", {
      extractable: true,
    });
    const publicJwk = await exportJWK(publicKey);
    const privateJwk = await exportJWK(privateKey);
    const kid = "old-kid";

    const oldDate = new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString();

    const mockKeyRow = {
      id: kid,
      publicKey: JSON.stringify(publicJwk),
      privateKey: JSON.stringify(privateJwk),
      algorithm: "RS256",
      createdAt: oldDate,
      expiresAt: undefined,
      revokedAt: undefined,
    };

    let callCount = 0;
    // eslint-disable-next-line unicorn/no-thenable -- Required: Drizzle chains are awaitable via a custom .then()
    dbMock.then = (resolve) => {
      callCount++;
      if (callCount === 1) {
        return resolve([mockKeyRow]);
      }
      return resolve([
        {
          ...mockKeyRow,
          id: "new-kid",
          createdAt: new Date().toISOString(),
        },
      ]);
    };

    const result = await store.getSigningKey();

    expect(result.kid).toBe("new-kid");
    expect(dbMock.insert).toHaveBeenCalled();
    expect(dbMock.update).toHaveBeenCalled();
    expect(dbMock.set).toHaveBeenCalledWith(
      expect.objectContaining({ expiresAt: expect.any(String) })
    );
  });

  it("should delete expired keys in cleanupKeys", async () => {
    await store.cleanupKeys();

    expect(dbMock.delete).toHaveBeenCalled();
    expect(dbMock.where).toHaveBeenCalled();
  });
});
