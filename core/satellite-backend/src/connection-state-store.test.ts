/**
 * Unit tests for the in-memory connection-state store backing the PLUGIN-
 * BACKED `satellite-connection` entity (Model B, reactive automation engine
 * §10.6). The store is the SOLE current-state home — there is no `entity_state`
 * mirror — and it is what the entity `read` accessor reads and the three
 * lifecycle `apply` writes mutate.
 */
import { describe, expect, it } from "bun:test";

import { createConnectionStateStore } from "./connection-state-store";
import type { SatelliteConnectionState } from "./entity";

const online = (over?: Partial<SatelliteConnectionState>): SatelliteConnectionState => ({
  status: "online",
  name: "edge-eu",
  region: "eu",
  lastSeenAt: "2026-05-31T00:00:00.000Z",
  lastEvent: "connected",
  ...over,
});

const offline = (over?: Partial<SatelliteConnectionState>): SatelliteConnectionState => ({
  status: "offline",
  name: "edge-eu",
  region: "eu",
  lastSeenAt: "2026-05-31T00:01:00.000Z",
  lastEvent: "disconnected",
  ...over,
});

describe("createConnectionStateStore", () => {
  it("readMany returns only present ids (source of truth = the in-memory map)", async () => {
    const store = createConnectionStateStore();
    store.write({ satelliteId: "sat-1", state: online() });
    const map = await store.readMany(["sat-1", "sat-missing"]);
    expect(map).toEqual({ "sat-1": online() });
    // A satellite that never connected on this instance is simply absent —
    // exactly the `prev === null` (create) signal the framework needs.
    expect(map["sat-missing"]).toBeUndefined();
  });

  it("readMany of an empty store yields an empty record", async () => {
    const store = createConnectionStateStore();
    expect(await store.readMany(["a", "b"])).toEqual({});
  });

  it("write upserts and returns the stored state (the `apply` return = next)", async () => {
    const store = createConnectionStateStore();
    const first = store.write({ satelliteId: "sat-1", state: online() });
    expect(first).toEqual(online());

    // A second write (disconnect) overwrites: read reflects the latest edge,
    // so the framework diffs the new state against the prior `online`.
    const second = store.write({ satelliteId: "sat-1", state: offline() });
    expect(second).toEqual(offline());
    expect(await store.readMany(["sat-1"])).toEqual({ "sat-1": offline() });
  });

  it("keeps connections independent by satelliteId", async () => {
    const store = createConnectionStateStore();
    store.write({ satelliteId: "sat-1", state: online() });
    store.write({
      satelliteId: "sat-2",
      state: online({ name: "edge-us", region: "us" }),
    });
    const map = await store.readMany(["sat-1", "sat-2"]);
    expect(map["sat-1"]?.region).toBe("eu");
    expect(map["sat-2"]?.region).toBe("us");
  });

  it("remove drops a satellite's connection state", async () => {
    const store = createConnectionStateStore();
    store.write({ satelliteId: "sat-1", state: online() });
    store.remove("sat-1");
    expect(await store.readMany(["sat-1"])).toEqual({});
  });
});
