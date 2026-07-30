import { describe, it, expect, mock, beforeEach } from "bun:test";
import { SatelliteService } from "./service";
import { OFFLINE_THRESHOLD_MS } from "@checkstack/satellite-common";

// Cast helper - creates a mock DB that satisfies the service's type requirements
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test utility for creating mock DB chains
type MockDb = Record<string, unknown>;

function createServiceWithMockDb(overrides?: {
  selectResult?: unknown[];
  insertResult?: unknown[];
}) {
  const selectResult = overrides?.selectResult ?? [];
  const insertResult = overrides?.insertResult ?? [];

  const db = {
    select: mock(() => ({
      from: mock(() => ({
        where: mock(() => Promise.resolve(selectResult)),
      })),
    })),
    insert: mock(() => ({
      values: mock(() => ({
        returning: mock(() => Promise.resolve(insertResult)),
      })),
    })),
    update: mock(() => ({
      set: mock(() => ({
        where: mock(() => Promise.resolve()),
      })),
    })),
    delete: mock(() => ({
      where: mock(() => Promise.resolve()),
    })),
  } as unknown as ConstructorParameters<typeof SatelliteService>[0];

  return { service: new SatelliteService(db), db };
}

/**
 * Unit tests for SatelliteService.
 * Uses lightweight mock DB focused on testing business logic.
 */
describe("SatelliteService", () => {
  describe("createSatellite", () => {
    it("should generate a token with the csat_ prefix", async () => {
      const mockRow = {
        id: "test-uuid-1",
        name: "EU West",
        region: "eu-west-1",
        tags: { provider: "aws" },
        tokenHash: "hashed",
        lastHeartbeatAt: null,
        version: null,
        createdAt: new Date(),
      };

      const { service } = createServiceWithMockDb({
        insertResult: [mockRow],
      });

      const result = await service.createSatellite({
        name: "EU West",
        region: "eu-west-1",
        tags: { provider: "aws" },
      });

      expect(result.plaintextToken).toMatch(/^csat_/);
      expect(result.plaintextToken.length).toBeGreaterThan(10);
      expect(result.satellite.name).toBe("EU West");
      expect(result.satellite.region).toBe("eu-west-1");
      expect(result.satellite.status).toBe("offline");
    });

    it("should generate unique tokens for different satellites", async () => {
      const makeRow = (name: string) => ({
        id: `uuid-${name}`,
        name,
        region: "us-east-1",
        tags: {},
        tokenHash: "hashed",
        lastHeartbeatAt: null,
        version: null,
        createdAt: new Date(),
      });

      let callCount = 0;
      const db = {
        select: mock(() => ({
          from: mock(() => ({
            where: mock(() => Promise.resolve([])),
          })),
        })),
        insert: mock(() => ({
          values: mock(() => ({
            returning: mock(() => {
              callCount++;
              return Promise.resolve([
                makeRow(callCount === 1 ? "Sat1" : "Sat2"),
              ]);
            }),
          })),
        })),
        update: mock(() => ({
          set: mock(() => ({
            where: mock(() => Promise.resolve()),
          })),
        })),
        delete: mock(() => ({
          where: mock(() => Promise.resolve()),
        })),
      } as unknown as ConstructorParameters<typeof SatelliteService>[0];

      const service = new SatelliteService(db);

      const result1 = await service.createSatellite({
        name: "Sat1",
        region: "us-east-1",
        tags: {},
      });
      const result2 = await service.createSatellite({
        name: "Sat2",
        region: "us-east-1",
        tags: {},
      });

      expect(result1.plaintextToken).not.toBe(result2.plaintextToken);
    });
  });

  describe("validateToken", () => {
    it("should validate a correct clientId + token pair", async () => {
      const testToken = "csat_test-token-for-validation";
      const hash = await Bun.password.hash(testToken, {
        algorithm: "bcrypt",
        cost: 10,
      });

      const { service } = createServiceWithMockDb({
        selectResult: [
          {
            id: "sat-id-1",
            name: "Test Sat",
            region: "us-east-1",
            tags: {},
            tokenHash: hash,
            lastHeartbeatAt: null,
            version: null,
            createdAt: new Date(),
          },
        ],
      });

      const result = await service.validateToken({
        clientId: "sat-id-1",
        token: testToken,
      });

      expect(result).toBeDefined();
      expect(result!.id).toBe("sat-id-1");
      expect(result!.name).toBe("Test Sat");
    });

    it("should reject an invalid token for a valid clientId", async () => {
      const hash = await Bun.password.hash("csat_correct-token", {
        algorithm: "bcrypt",
        cost: 10,
      });

      const { service } = createServiceWithMockDb({
        selectResult: [
          {
            id: "sat-id-2",
            name: "Sat",
            region: "eu",
            tags: {},
            tokenHash: hash,
            lastHeartbeatAt: null,
            version: null,
            createdAt: new Date(),
          },
        ],
      });

      const result = await service.validateToken({
        clientId: "sat-id-2",
        token: "csat_wrong-token",
      });

      expect(result).toBeUndefined();
    });

    it("should reject a non-existent clientId", async () => {
      const { service } = createServiceWithMockDb({
        selectResult: [],
      });

      const result = await service.validateToken({
        clientId: "non-existent",
        token: "csat_any-token",
      });

      expect(result).toBeUndefined();
    });

    it("runs a bcrypt verify even for a missing clientId (timing-oracle guard)", async () => {
      // Regression guard: a missing clientId MUST still perform a bcrypt verify
      // (against a decoy hash) so its response time matches the wrong-token
      // path. Otherwise an attacker could enumerate valid client IDs by timing.
      const verifySpy = mock((_password: string, _hash: string) =>
        Promise.resolve(false),
      );
      const original = Bun.password.verify;
      // Replace with a spy that resolves false (decoy never matches).
      Bun.password.verify = verifySpy as unknown as typeof Bun.password.verify;

      try {
        const { service } = createServiceWithMockDb({ selectResult: [] });

        const result = await service.validateToken({
          clientId: "definitely-missing",
          token: "csat_any-token",
        });

        expect(result).toBeUndefined();
        // The key assertion: a verify WAS performed despite no DB row.
        expect(verifySpy).toHaveBeenCalledTimes(1);
        // And it was called with the supplied token (against the decoy hash).
        expect(verifySpy.mock.calls[0][0]).toBe("csat_any-token");
        expect(typeof verifySpy.mock.calls[0][1]).toBe("string");
      } finally {
        Bun.password.verify = original;
      }
    });
  });

  describe("listSatellites", () => {
    it("should compute online status from heartbeat timestamp", async () => {
      const now = new Date();
      const recentHeartbeat = new Date(now.getTime() - 10_000);
      const staleHeartbeat = new Date(
        now.getTime() - OFFLINE_THRESHOLD_MS - 1000,
      );

      const db = {
        select: mock(() => ({
          from: mock(() =>
            Promise.resolve([
              {
                id: "online-sat",
                name: "Online",
                region: "us-east-1",
                tags: {},
                tokenHash: "hash",
                lastHeartbeatAt: recentHeartbeat,
                version: "1.0.0",
                createdAt: now,
              },
              {
                id: "offline-sat",
                name: "Offline",
                region: "eu-west-1",
                tags: {},
                tokenHash: "hash",
                lastHeartbeatAt: staleHeartbeat,
                version: "1.0.0",
                createdAt: now,
              },
              {
                id: "never-connected",
                name: "Never",
                region: "ap-south-1",
                tags: {},
                tokenHash: "hash",
                lastHeartbeatAt: null,
                version: null,
                createdAt: now,
              },
            ]),
          ),
        })),
      } as unknown as ConstructorParameters<typeof SatelliteService>[0];

      const service = new SatelliteService(db);
      const list = await service.listSatellites();

      expect(list).toHaveLength(3);
      expect(list[0].status).toBe("online");
      expect(list[1].status).toBe("offline");
      expect(list[2].status).toBe("offline");
    });
  });

  describe("getOnlineSatelliteIds", () => {
    it("should only return IDs of satellites with recent heartbeats", async () => {
      const now = new Date();
      const recentHeartbeat = new Date(now.getTime() - 5000);

      const db = {
        select: mock(() => ({
          from: mock(() =>
            Promise.resolve([
              { id: "online-1", lastHeartbeatAt: recentHeartbeat },
              { id: "offline-1", lastHeartbeatAt: null },
              {
                id: "offline-2",
                lastHeartbeatAt: new Date(
                  now.getTime() - OFFLINE_THRESHOLD_MS - 1000,
                ),
              },
            ]),
          ),
        })),
      } as unknown as ConstructorParameters<typeof SatelliteService>[0];

      const service = new SatelliteService(db);
      const ids = await service.getOnlineSatelliteIds();

      expect(ids).toEqual(["online-1"]);
    });
  });

  describe("getManyConnectionStates (durable, compute-on-read entity read)", () => {
    it("computes online status from a recent durable lastHeartbeatAt", async () => {
      const recent = new Date(Date.now() - 5_000);
      let whereArg: unknown;
      const db = {
        select: mock(() => ({
          from: mock(() => ({
            where: mock((arg: unknown) => {
              whereArg = arg;
              return Promise.resolve([
                {
                  id: "sat-1",
                  name: "edge-eu",
                  region: "eu",
                  lastHeartbeatAt: recent,
                  lastConnectionEvent: "connected",
                },
              ]);
            }),
          })),
        })),
      } as unknown as ConstructorParameters<typeof SatelliteService>[0];

      const service = new SatelliteService(db);
      const out = await service.getManyConnectionStates(["sat-1", "sat-2"]);

      expect(whereArg).toBeDefined();
      expect(out).toEqual({
        "sat-1": {
          status: "online",
          name: "edge-eu",
          region: "eu",
          lastSeenAt: recent.toISOString(),
          lastEvent: "connected",
        },
      });
      // A satellite absent from the result is simply omitted (prev === null).
      expect(out["sat-2"]).toBeUndefined();
    });

    it("self-heals an aged-out row to offline (crashed pod left it 'connected')", async () => {
      // The horizontal-scale fix: a satellite whose heartbeat aged past the
      // threshold reads OFFLINE even though its last edge is still `connected`,
      // because status is computed, never a stuck stored copy.
      const aged = new Date(Date.now() - OFFLINE_THRESHOLD_MS - 10_000);
      const db = {
        select: mock(() => ({
          from: mock(() => ({
            where: mock(() =>
              Promise.resolve([
                {
                  id: "sat-1",
                  name: "edge-eu",
                  region: "eu",
                  lastHeartbeatAt: aged,
                  lastConnectionEvent: "connected",
                },
              ]),
            ),
          })),
        })),
      } as unknown as ConstructorParameters<typeof SatelliteService>[0];

      const service = new SatelliteService(db);
      const out = await service.getManyConnectionStates(["sat-1"]);
      expect(out["sat-1"]!.status).toBe("offline");
    });

    it("omits never-connected satellites (null lastConnectionEvent)", async () => {
      const db = {
        select: mock(() => ({
          from: mock(() => ({
            where: mock(() =>
              Promise.resolve([
                {
                  id: "sat-1",
                  name: "edge-eu",
                  region: "eu",
                  lastHeartbeatAt: null,
                  lastConnectionEvent: null,
                },
              ]),
            ),
          })),
        })),
      } as unknown as ConstructorParameters<typeof SatelliteService>[0];

      const service = new SatelliteService(db);
      expect(await service.getManyConnectionStates(["sat-1"])).toEqual({});
    });

    it("short-circuits an empty id list without touching the db", async () => {
      const select = mock(() => ({ from: mock() }));
      const db = { select } as unknown as ConstructorParameters<
        typeof SatelliteService
      >[0];
      const service = new SatelliteService(db);
      expect(await service.getManyConnectionStates([])).toEqual({});
      expect(select).not.toHaveBeenCalled();
    });
  });

  describe("applyConnectionState (durable lifecycle write)", () => {
    it("connect: sets lastHeartbeatAt=now + connected and returns an online view", async () => {
      const now = new Date(Date.now() - 1_000);
      let setArg:
        | { lastConnectionEvent?: string; lastHeartbeatAt?: Date | null }
        | undefined;
      const db = {
        update: mock(() => ({
          set: mock((arg: typeof setArg) => {
            setArg = arg;
            return {
              where: mock(() => ({
                returning: mock(() =>
                  Promise.resolve([
                    {
                      id: "sat-1",
                      name: "edge-eu",
                      region: "eu",
                      lastConnectionEvent: "connected",
                      tags: {},
                      tokenHash: "h",
                      lastHeartbeatAt: now,
                      version: null,
                      createdAt: new Date(),
                    },
                  ]),
                ),
              })),
            };
          }),
        })),
      } as unknown as ConstructorParameters<typeof SatelliteService>[0];

      const service = new SatelliteService(db);
      const next = await service.applyConnectionState({
        satelliteId: "sat-1",
        lastEvent: "connected",
        lastHeartbeatAt: now,
      });

      expect(setArg).toEqual({
        lastConnectionEvent: "connected",
        lastHeartbeatAt: now,
      });
      expect(next).toEqual({
        status: "online",
        name: "edge-eu",
        region: "eu",
        lastSeenAt: now.toISOString(),
        lastEvent: "connected",
      });
    });

    it("clean disconnect: clears lastHeartbeatAt (null) so the view is offline immediately", async () => {
      let setArg:
        | { lastConnectionEvent?: string; lastHeartbeatAt?: Date | null }
        | undefined;
      const db = {
        update: mock(() => ({
          set: mock((arg: typeof setArg) => {
            setArg = arg;
            return {
              where: mock(() => ({
                returning: mock(() =>
                  Promise.resolve([
                    {
                      id: "sat-1",
                      name: "edge-eu",
                      region: "eu",
                      lastConnectionEvent: "disconnected",
                      tags: {},
                      tokenHash: "h",
                      lastHeartbeatAt: null,
                      version: null,
                      createdAt: new Date(),
                    },
                  ]),
                ),
              })),
            };
          }),
        })),
      } as unknown as ConstructorParameters<typeof SatelliteService>[0];

      const service = new SatelliteService(db);
      const next = await service.applyConnectionState({
        satelliteId: "sat-1",
        lastEvent: "disconnected",
        lastHeartbeatAt: null,
      });

      expect(setArg).toEqual({
        lastConnectionEvent: "disconnected",
        lastHeartbeatAt: null,
      });
      expect(next).toEqual({
        status: "offline",
        name: "edge-eu",
        region: "eu",
        lastSeenAt: null,
        lastEvent: "disconnected",
      });
    });

    it("heartbeat_lost: flips ONLY lastConnectionEvent, leaving the aged heartbeat untouched", async () => {
      const aged = new Date(Date.now() - OFFLINE_THRESHOLD_MS - 10_000);
      let setArg:
        | { lastConnectionEvent?: string; lastHeartbeatAt?: Date | null }
        | undefined;
      const db = {
        update: mock(() => ({
          set: mock((arg: typeof setArg) => {
            setArg = arg;
            return {
              where: mock(() => ({
                returning: mock(() =>
                  Promise.resolve([
                    {
                      id: "sat-1",
                      name: "edge-eu",
                      region: "eu",
                      lastConnectionEvent: "heartbeat_lost",
                      tags: {},
                      tokenHash: "h",
                      lastHeartbeatAt: aged,
                      version: null,
                      createdAt: new Date(),
                    },
                  ]),
                ),
              })),
            };
          }),
        })),
      } as unknown as ConstructorParameters<typeof SatelliteService>[0];

      const service = new SatelliteService(db);
      const next = await service.applyConnectionState({
        satelliteId: "sat-1",
        lastEvent: "heartbeat_lost",
        // lastHeartbeatAt omitted ⇒ left unchanged.
      });

      // Only the event column was written — no lastHeartbeatAt key.
      expect(setArg).toEqual({ lastConnectionEvent: "heartbeat_lost" });
      expect(next.status).toBe("offline");
      expect(next.lastEvent).toBe("heartbeat_lost");
      expect(next.lastSeenAt).toBe(aged.toISOString());
    });

    it("throws when the satellite no longer exists", async () => {
      const db = {
        update: mock(() => ({
          set: mock(() => ({
            where: mock(() => ({
              returning: mock(() => Promise.resolve([])),
            })),
          })),
        })),
      } as unknown as ConstructorParameters<typeof SatelliteService>[0];

      const service = new SatelliteService(db);
      await expect(
        service.applyConnectionState({
          satelliteId: "gone",
          lastEvent: "connected",
          lastHeartbeatAt: new Date(),
        }),
      ).rejects.toThrow(/not found/);
    });
  });
});

/**
 * DRIFT GUARD: every read path must honour the satellite's OWN threshold.
 *
 * `computeStatus` is called from five places - the heartbeat monitor, the
 * reactive entity read, and three service reads. Making the threshold
 * per-satellite means each of them has to supply it; a site that forgets
 * silently falls back to the global default, and then the admin list, the
 * entity state and the monitor disagree about whether the SAME satellite is
 * online. Nothing about that failure is loud: each site looks correct in
 * isolation and its own unit tests still pass.
 *
 * `status.test.ts` proves `resolveOfflineThresholdMs` is correct; it cannot
 * prove the callers pass it. These drive the real service reads with a
 * heartbeat that is stale by the GLOBAL default but fresh by the satellite's
 * own longer threshold - so any site that dropped the argument reports offline
 * and fails here.
 */
describe("per-satellite offline threshold is honoured by every read path", () => {
  // Comfortably past the 45s global default, comfortably inside 10 minutes.
  const STALE_BY_DEFAULT_FRESH_BY_CUSTOM_MS = 5 * 60_000;
  const CUSTOM_THRESHOLD_MS = 30 * 60_000;

  /**
   * Local DB stub: these reads differ in shape - some select without a
   * `where`, some with one - so the chain has to be awaitable at BOTH points.
   * The shared helper above only resolves after `.where()`.
   */
  function serviceWithRows(rows: unknown[]) {
    const chain = {
      where: () => Promise.resolve(rows),
      // Thenable, so `await db.select().from(...)` resolves too.
      then: (onFulfilled: (value: unknown[]) => unknown) =>
        Promise.resolve(rows).then(onFulfilled),
    };
    const db = {
      select: () => ({ from: () => chain }),
    } as unknown as ConstructorParameters<typeof SatelliteService>[0];
    return new SatelliteService(db);
  }

  const tolerantRow = () => ({
    id: "sat-tolerant",
    name: "Tolerant",
    region: "eu",
    lastHeartbeatAt: new Date(
      Date.now() - STALE_BY_DEFAULT_FRESH_BY_CUSTOM_MS,
    ),
    offlineThresholdMs: CUSTOM_THRESHOLD_MS,
    lastConnectionEvent: "connected" as const,
    capabilities: null,
  });

  it("sanity: the fixture IS stale by the global default", () => {
    // If this ever stops holding, the tests below would pass vacuously.
    expect(STALE_BY_DEFAULT_FRESH_BY_CUSTOM_MS).toBeGreaterThan(
      OFFLINE_THRESHOLD_MS,
    );
    expect(STALE_BY_DEFAULT_FRESH_BY_CUSTOM_MS).toBeLessThan(
      CUSTOM_THRESHOLD_MS,
    );
  });

  it("getOnlineSatelliteIds counts it as ONLINE", async () => {
    const service = serviceWithRows([tolerantRow()]);

    expect(await service.getOnlineSatelliteIds()).toEqual(["sat-tolerant"]);
  });

  it("getManyConnectionStates reports it ONLINE", async () => {
    const service = serviceWithRows([tolerantRow()]);

    const states = await service.getManyConnectionStates(["sat-tolerant"]);
    expect(states["sat-tolerant"]?.status).toBe("online");
  });

  it("listSatellites reports it ONLINE", async () => {
    // The fifth call site: `toSatelliteWithStatus`, which backs every
    // list/get read the admin UI shows.
    const service = serviceWithRows([tolerantRow()]);

    const rows = await service.listSatellites();
    expect(rows.find((r) => r.id === "sat-tolerant")?.status).toBe("online");
  });

  it("listConnectionLiveness carries the threshold to its caller", async () => {
    // This read deliberately does NOT compute status - it returns raw rows and
    // the caller decides. Dropping the column here would silently make every
    // consumer fall back to the global default.
    const service = serviceWithRows([tolerantRow()]);

    const rows = await service.listConnectionLiveness();
    expect(rows.find((r) => r.id === "sat-tolerant")?.offlineThresholdMs).toBe(
      CUSTOM_THRESHOLD_MS,
    );
  });

  it("a satellite with NO custom threshold still uses the global default", async () => {
    // The other direction: per-satellite support must not accidentally make
    // every satellite tolerant.
    const service = serviceWithRows([
      { ...tolerantRow(), offlineThresholdMs: null },
    ]);

    expect(await service.getOnlineSatelliteIds()).toEqual([]);
  });

  it("a SHORTER custom threshold marks it offline sooner than the default", async () => {
    // Tolerance cuts both ways: a satellite that must heartbeat aggressively
    // goes offline before the global default would.
    const service = serviceWithRows([
      {
        ...tolerantRow(),
        lastHeartbeatAt: new Date(Date.now() - 20_000),
        offlineThresholdMs: 10_000,
      },
    ]);

    expect(await service.getOnlineSatelliteIds()).toEqual([]);
  });
});
