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
