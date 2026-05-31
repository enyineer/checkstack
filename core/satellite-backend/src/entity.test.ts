/**
 * Unit tests for the satellite-connection reactive-entity mapping (reactive
 * automation engine §10.6, §9.1). Proves the deriver returns the EXACT
 * qualified trigger event ids existing automations match — including the
 * three-way connected / disconnected / heartbeat_lost distinction carried
 * by the `lastEvent` discriminator.
 */
import { describe, expect, it } from "bun:test";
import { SYSTEM_ACTOR } from "@checkstack/common";
import type { EntityChanged } from "@checkstack/automation-common";

import {
  SATELLITE_CONNECTED_EVENT,
  SATELLITE_DISCONNECTED_EVENT,
  SATELLITE_HEARTBEAT_LOST_EVENT,
  createSatelliteConnectionRead,
  deriveSatelliteConnectionEvents,
  satelliteConnectionStateSchema,
  toSatelliteConnectionState,
  type SatelliteConnectionState,
} from "./entity";
import type { SatelliteService } from "./service";

function makeChange(over: Partial<EntityChanged>): EntityChanged {
  return {
    kind: "satellite-connection",
    id: "sat-1",
    prev: null,
    next: {
      status: "online",
      name: "edge-eu",
      region: "eu",
      lastSeenAt: "2026-05-31T00:00:00.000Z",
      lastEvent: "connected",
    },
    delta: {},
    changedFields: [],
    actor: SYSTEM_ACTOR,
    occurredAt: "2026-05-31T00:00:00.000Z",
    ...over,
  };
}

describe("deriveSatelliteConnectionEvents", () => {
  it("maps lastEvent='connected' to satellite.connected", () => {
    expect(deriveSatelliteConnectionEvents(makeChange({}))).toEqual([
      SATELLITE_CONNECTED_EVENT,
    ]);
  });

  it("maps lastEvent='disconnected' to satellite.disconnected", () => {
    const change = makeChange({
      prev: {
        status: "online",
        name: "edge-eu",
        region: "eu",
        lastSeenAt: "2026-05-31T00:00:00.000Z",
        lastEvent: "connected",
      },
      next: {
        status: "offline",
        name: "edge-eu",
        region: "eu",
        lastSeenAt: "2026-05-31T00:01:00.000Z",
        lastEvent: "disconnected",
      },
    });
    expect(deriveSatelliteConnectionEvents(change)).toEqual([
      SATELLITE_DISCONNECTED_EVENT,
    ]);
  });

  it("maps lastEvent='heartbeat_lost' to satellite.heartbeat_lost (distinct from disconnected)", () => {
    const change = makeChange({
      prev: {
        status: "online",
        name: "edge-eu",
        region: "eu",
        lastSeenAt: "2026-05-31T00:00:00.000Z",
        lastEvent: "connected",
      },
      next: {
        status: "offline",
        name: "edge-eu",
        region: "eu",
        lastSeenAt: "2026-05-31T00:05:00.000Z",
        lastEvent: "heartbeat_lost",
      },
    });
    expect(deriveSatelliteConnectionEvents(change)).toEqual([
      SATELLITE_HEARTBEAT_LOST_EVENT,
    ]);
  });

  it("fires nothing on a tombstone (next === null)", () => {
    const change = makeChange({
      prev: {
        status: "online",
        name: "edge-eu",
        region: "eu",
        lastSeenAt: "2026-05-31T00:00:00.000Z",
        lastEvent: "connected",
      },
      next: null,
    });
    expect(deriveSatelliteConnectionEvents(change)).toEqual([]);
  });

  it("fires nothing when lastEvent is missing/invalid", () => {
    const change = makeChange({
      next: {
        status: "online",
        name: "edge-eu",
        region: "eu",
        lastSeenAt: "2026-05-31T00:00:00.000Z",
        // lastEvent intentionally absent
      },
    });
    expect(deriveSatelliteConnectionEvents(change)).toEqual([]);
  });

  it("returns event ids that exactly equal the qualified trigger ids", () => {
    expect(SATELLITE_CONNECTED_EVENT).toBe("satellite.connected");
    expect(SATELLITE_DISCONNECTED_EVENT).toBe("satellite.disconnected");
    expect(SATELLITE_HEARTBEAT_LOST_EVENT).toBe("satellite.heartbeat_lost");
  });
});

describe("satelliteConnectionStateSchema", () => {
  it("accepts the canonical state shape", () => {
    const ok = satelliteConnectionStateSchema.safeParse({
      status: "offline",
      name: "edge-eu",
      region: "eu",
      lastSeenAt: "2026-05-31T00:00:00.000Z",
      lastEvent: "heartbeat_lost",
    });
    expect(ok.success).toBe(true);
  });

  it("rejects an unknown status", () => {
    const bad = satelliteConnectionStateSchema.safeParse({
      status: "degraded",
      name: "edge-eu",
      region: "eu",
      lastSeenAt: "2026-05-31T00:00:00.000Z",
      lastEvent: "connected",
    });
    expect(bad.success).toBe(false);
  });
});

describe("toSatelliteConnectionState", () => {
  it("projects a durable connection row onto the reactive view", () => {
    const seen = new Date("2026-05-31T00:00:00.000Z");
    expect(
      toSatelliteConnectionState({
        status: "online",
        name: "edge-eu",
        region: "eu",
        lastSeenAt: seen,
        lastConnectionEvent: "connected",
      }),
    ).toEqual({
      status: "online",
      name: "edge-eu",
      region: "eu",
      lastSeenAt: "2026-05-31T00:00:00.000Z",
      lastEvent: "connected",
    });
  });

  it("returns null for a never-connected satellite (no last edge yet)", () => {
    // A satellite created but never connected has null lastSeenAt /
    // lastConnectionEvent — it has no entity state, so the read omits it and
    // the framework sees the first connect as a create (prev === null).
    expect(
      toSatelliteConnectionState({
        status: "offline",
        name: "edge-eu",
        region: "eu",
        lastSeenAt: null,
        lastConnectionEvent: null,
      }),
    ).toBeNull();
  });
});

describe("createSatelliteConnectionRead", () => {
  it("routes the batched read straight to the durable service read", async () => {
    // Proves the entity `read` resolves from the service (the durable
    // `satellites` table) — so a fresh service instance, i.e. ANOTHER POD,
    // sees the SAME state. This is the horizontal-scaling fix.
    const seen: ReadonlyArray<string>[] = [];
    const durableState: SatelliteConnectionState = {
      status: "online",
      name: "edge-eu",
      region: "eu",
      lastSeenAt: "2026-05-31T00:00:00.000Z",
      lastEvent: "connected",
    };
    const service = {
      async getManyConnectionStates(ids: ReadonlyArray<string>) {
        seen.push(ids);
        return { "sat-1": durableState };
      },
    } as unknown as SatelliteService;

    const read = createSatelliteConnectionRead(service);
    const out = await read(["sat-1", "sat-2"]);
    expect(seen).toEqual([["sat-1", "sat-2"]]);
    expect(out["sat-1"]).toEqual(durableState);
    expect(out["sat-2"]).toBeUndefined();
  });
});
