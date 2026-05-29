/**
 * Behaviour tests for the satellite automation triggers.
 * No mutation actions in this chunk — connection lifecycle is observed
 * only, not commanded.
 */
import { describe, expect, it } from "bun:test";

import {
  satelliteConnectedTrigger,
  satelliteDisconnectedTrigger,
  satelliteHeartbeatLostTrigger,
  satelliteTriggers,
} from "./automations";
import { satelliteHooks } from "./hooks";

describe("satellite triggers", () => {
  it("exposes three triggers in a stable order", () => {
    expect(satelliteTriggers).toHaveLength(3);
    expect(satelliteTriggers[0]).toBe(
      satelliteConnectedTrigger as (typeof satelliteTriggers)[number],
    );
    expect(satelliteTriggers[1]).toBe(
      satelliteDisconnectedTrigger as (typeof satelliteTriggers)[number],
    );
    expect(satelliteTriggers[2]).toBe(
      satelliteHeartbeatLostTrigger as (typeof satelliteTriggers)[number],
    );
  });

  it("binds each trigger to the matching hook", () => {
    expect(satelliteConnectedTrigger.hook).toBe(satelliteHooks.connected);
    expect(satelliteDisconnectedTrigger.hook).toBe(satelliteHooks.disconnected);
    expect(satelliteHeartbeatLostTrigger.hook).toBe(satelliteHooks.heartbeatLost);
  });

  it("extracts satelliteId as the contextKey on all three", () => {
    const payload = {
      satelliteId: "sat-1",
      name: "EU-Central",
      region: "eu-central-1",
      timestamp: "2026-05-29T11:00:00Z",
    };
    expect(satelliteConnectedTrigger.contextKey?.(payload)).toBe("sat-1");
    expect(satelliteDisconnectedTrigger.contextKey?.(payload)).toBe("sat-1");
    expect(satelliteHeartbeatLostTrigger.contextKey?.(payload)).toBe("sat-1");
  });

  it("rejects payloads missing required fields", () => {
    const bad = satelliteConnectedTrigger.payloadSchema.safeParse({
      satelliteId: "sat-1",
    });
    expect(bad.success).toBe(false);
  });
});
