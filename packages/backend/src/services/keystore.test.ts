import { describe, it, expect, mock, beforeEach } from "bun:test";
import { KeyStore } from "./keystore";

// 1. Mock the DB module
const mockDb = {
  insert: mock(() => ({
    values: mock(() => Promise.resolve()),
  })),
  select: mock(() => mockDb),
  from: mock(() => mockDb),
  where: mock(() => mockDb),
  orderBy: mock(() => mockDb),
  limit: mock(() => mockDb),
};

// Return empty list by default for selects
// We will override implementation per test if needed
// But since the chain returns `mockDb` (itself), the final await needs to return data.
// Wait, `await db.select()...` means the object must be thenable or the last method returns a Promise.
// Drizzle: .execute() or await directly.
// In the code: `const validKeys = await db.select()...`
// So the object returned by `limit()` must be thenable.

const mockChain = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  chain.insert = mock(() => chain);
  chain.values = mock(() => Promise.resolve());

  chain.select = mock(() => chain);
  chain.from = mock(() => chain);
  chain.where = mock(() => chain);
  chain.orderBy = mock(() => chain);
  chain.limit = mock(() => chain); // limit is the last one called in getSigningKey

  // Make it thenable to simulate 'await'
  // eslint-disable-next-line unicorn/no-thenable, @typescript-eslint/no-explicit-any
  chain.then = (resolve: any) => resolve([]); // Default empty array

  return chain;
};

const dbMockInstance = mockChain();

mock.module("../db", () => {
  return {
    db: dbMockInstance,
  };
});

describe("KeyStore", () => {
  let store: KeyStore;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockKeyForGeneration: any;

  beforeEach(async () => {
    store = new KeyStore();
    // Reset mocks
    dbMockInstance.select.mockClear();
    dbMockInstance.insert.mockClear();

    // Reset default behavior
    // eslint-disable-next-line unicorn/no-thenable, @typescript-eslint/no-explicit-any
    dbMockInstance.then = (resolve: any) => resolve([]);

    // Pre-generate a valid key for mocking responses
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
    // Mock DB returning empty array for existing keys first, then the new key
    let callCount = 0;
    // eslint-disable-next-line unicorn/no-thenable, @typescript-eslint/no-explicit-any
    dbMockInstance.then = (resolve: any) => {
      callCount++;
      if (callCount === 1) {
        return resolve([]); // First call: no active key
      }
      return resolve([mockKeyForGeneration]);
    };

    const result = await store.getSigningKey();

    expect(result.kid).toBe("generated-kid"); // The mock key ID
    expect(result.key).toBeTruthy();
    expect(dbMockInstance.insert).toHaveBeenCalled();
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
      createdAt: new Date().toISOString(), // Fresh
      expiresAt: undefined,
      revokedAt: undefined,
    };

    // Mock DB return
    // eslint-disable-next-line unicorn/no-thenable, @typescript-eslint/no-explicit-any
    dbMockInstance.then = (resolve: any) => resolve([mockKeyRow]);

    const result = await store.getSigningKey();

    expect(result.kid).toBe(kid);
    // Should NOT have called insert (no rotation)
    expect(dbMockInstance.insert).not.toHaveBeenCalled();
  });

  it("should rotate key if the existing one is too old", async () => {
    // Generate a real key
    const { generateKeyPair, exportJWK } = await import("jose");
    const { publicKey, privateKey } = await generateKeyPair("RS256", {
      extractable: true,
    });
    const publicJwk = await exportJWK(publicKey);
    const privateJwk = await exportJWK(privateKey);
    const kid = "old-kid";

    // Create an OLD date > 1 hour ago
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
    // eslint-disable-next-line unicorn/no-thenable, @typescript-eslint/no-explicit-any
    dbMockInstance.then = (resolve: any) => {
      callCount++;
      if (callCount === 1) {
        return resolve([mockKeyRow]); // First call: check active
      }
      // Second call: fetch new key (in rotate logic)
      // We need to return a valid new key so it doesn't crash
      return resolve([
        {
          ...mockKeyRow,
          id: "new-kid",
          createdAt: new Date().toISOString(),
        },
      ]);
    };

    const result = await store.getSigningKey();

    expect(result.kid).toBe("new-kid"); // Should return the NEW key
    expect(dbMockInstance.insert).toHaveBeenCalled();
  });
});
