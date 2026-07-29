import { describe, expect, test } from "bun:test";
import { buildSatelliteConnectionNotification } from "./connection-notifications";

const base = { satelliteId: "sat-1", name: "edge-eu", region: "eu-west-1" };

describe("buildSatelliteConnectionNotification", () => {
  test("a lost heartbeat is a WARNING, because checks silently stop", () => {
    // This is the case the whole feature exists for. Downgrading it to info
    // would bury it in a digest alongside routine reconnects.
    const notification = buildSatelliteConnectionNotification({
      ...base,
      event: "heartbeat_lost",
    });

    expect(notification.importance).toBe("warning");
    expect(notification.title).toContain("offline");
  });

  test("the offline body explains the consequence, not just the event", () => {
    const { body } = buildSatelliteConnectionNotification({
      ...base,
      event: "heartbeat_lost",
    });

    expect(body).toContain("not running");
    expect(body).toContain("last known status");
  });

  test("a clean disconnect is informational", () => {
    // An orderly socket close is a restart or a redeploy, not an incident.
    expect(
      buildSatelliteConnectionNotification({ ...base, event: "disconnected" })
        .importance,
    ).toBe("info");
  });

  test("a reconnect is informational", () => {
    expect(
      buildSatelliteConnectionNotification({ ...base, event: "connected" })
        .importance,
    ).toBe("info");
  });

  test("every event names the satellite and its region", () => {
    for (const event of ["connected", "disconnected", "heartbeat_lost"] as const) {
      const { body, title } = buildSatelliteConnectionNotification({
        ...base,
        event,
      });

      expect(title).toContain("edge-eu");
      expect(body).toContain("edge-eu");
      expect(body).toContain("eu-west-1");
    }
  });

  test("all events for one satellite share a collapse key", () => {
    // A flapping link must replace its own previous notice rather than stack
    // one notification per transition.
    const keys = (["connected", "disconnected", "heartbeat_lost"] as const).map(
      (event) =>
        buildSatelliteConnectionNotification({ ...base, event }).collapseKey,
    );

    expect(new Set(keys).size).toBe(1);
  });

  test("different satellites do NOT share a collapse key", () => {
    const a = buildSatelliteConnectionNotification({
      ...base,
      event: "heartbeat_lost",
    });
    const b = buildSatelliteConnectionNotification({
      ...base,
      satelliteId: "sat-2",
      event: "heartbeat_lost",
    });

    expect(a.collapseKey).not.toBe(b.collapseKey);
  });

  test("every event carries an action link", () => {
    for (const event of ["connected", "disconnected", "heartbeat_lost"] as const) {
      const { action } = buildSatelliteConnectionNotification({
        ...base,
        event,
      });

      expect(action.url.length).toBeGreaterThan(0);
      expect(action.label.length).toBeGreaterThan(0);
    }
  });
});
