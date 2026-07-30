/**
 * Unit tests for the satellite-connection reactive-entity mapping (reactive
 * automation engine §10.6, §9.1). Proves the deriver returns the EXACT
 * qualified trigger event ids existing automations match — including the
 * three-way connected / disconnected / heartbeat_lost distinction carried
 * by the `lastEvent` discriminator.
 */
import { describe, expect, it } from "bun:test";
import { SYSTEM_ACTOR } from "@checkstack/common";
import { OFFLINE_THRESHOLD_MS } from "@checkstack/satellite-common";
import type { EntityChanged } from "@checkstack/automation-common";

import {
  SATELLITE_CONNECTED_EVENT,
  SATELLITE_DISCONNECTED_EVENT,
  SATELLITE_HEARTBEAT_LOST_EVENT,
  createSatelliteConnectionRead,
  deriveSatelliteConnectionEvents,
  satelliteChangeToPayload,
  satelliteConnectionStateSchema,
  toSatelliteConnectionState,
  type SatelliteConnectionState,
} from "./entity";
import {
  satelliteConnectedTrigger,
  satelliteDisconnectedTrigger,
  satelliteHeartbeatLostTrigger,
} from "./automations";
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

describe("satelliteChangeToPayload — payloadSchema parity", () => {
  it("a connect payload validates against the connected trigger's payloadSchema", () => {
    const parsed = satelliteConnectedTrigger.payloadSchema.parse(
      satelliteChangeToPayload(makeChange({})),
    );
    expect(parsed.satelliteId).toBe("sat-1");
    expect(parsed.name).toBe("edge-eu");
    expect(parsed.region).toBe("eu");
    expect(parsed.status).toBe("online");
    expect(parsed.lastSeenAt).toBe("2026-05-31T00:00:00.000Z");
  });

  it("a disconnect payload validates (lastSeenAt null after clean disconnect)", () => {
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
        lastSeenAt: null,
        lastEvent: "disconnected",
      },
    });
    const parsed = satelliteDisconnectedTrigger.payloadSchema.parse(
      satelliteChangeToPayload(change),
    );
    expect(parsed.satelliteId).toBe("sat-1");
    expect(parsed.status).toBe("offline");
    expect(parsed.lastSeenAt).toBeNull();
  });

  it("a heartbeat-lost payload validates against the heartbeat_lost trigger's payloadSchema", () => {
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
        lastSeenAt: "2026-05-31T00:00:00.000Z",
        lastEvent: "heartbeat_lost",
      },
    });
    const parsed = satelliteHeartbeatLostTrigger.payloadSchema.parse(
      satelliteChangeToPayload(change),
    );
    expect(parsed.satelliteId).toBe("sat-1");
    expect(parsed.status).toBe("offline");
  });
});

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
  it("computes online status from a recent lastHeartbeatAt", () => {
    const recent = new Date(Date.now() - 5_000);
    const state = toSatelliteConnectionState({
      name: "edge-eu",
      region: "eu",
      lastHeartbeatAt: recent,
      offlineThresholdMs: null,
      lastConnectionEvent: "connected",
    });
    expect(state).toEqual({
      status: "online",
      name: "edge-eu",
      region: "eu",
      lastSeenAt: recent.toISOString(),
      lastEvent: "connected",
    });
  });

  it("computes offline (self-heals) when lastHeartbeatAt has aged past the threshold", () => {
    // This is the crash-recovery property: a row left marked `connected` by a
    // crashed pod reads `offline` purely because its heartbeat aged out — the
    // status is computed, never a stuck stored copy.
    const aged = new Date(Date.now() - OFFLINE_THRESHOLD_MS - 10_000);
    const state = toSatelliteConnectionState({
      name: "edge-eu",
      region: "eu",
      lastHeartbeatAt: aged,
      offlineThresholdMs: null,
      lastConnectionEvent: "connected",
    });
    expect(state!.status).toBe("offline");
    expect(state!.lastSeenAt).toBe(aged.toISOString());
    expect(state!.lastEvent).toBe("connected");
  });

  it("computes offline with null lastSeenAt after a clean disconnect (lastHeartbeatAt cleared)", () => {
    const state = toSatelliteConnectionState({
      name: "edge-eu",
      region: "eu",
      lastHeartbeatAt: null,
      offlineThresholdMs: null,
      lastConnectionEvent: "disconnected",
    });
    expect(state).toEqual({
      status: "offline",
      name: "edge-eu",
      region: "eu",
      lastSeenAt: null,
      lastEvent: "disconnected",
    });
  });

  it("returns null for a never-connected satellite (no last edge yet)", () => {
    // A satellite created but never connected has null lastConnectionEvent — it
    // has no entity state, so the read omits it and the framework sees the first
    // connect as a create (prev === null).
    expect(
      toSatelliteConnectionState({
        name: "edge-eu",
        region: "eu",
        lastHeartbeatAt: null,
        offlineThresholdMs: null,
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
