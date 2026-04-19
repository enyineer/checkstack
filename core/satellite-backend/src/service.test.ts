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
});
