import { describe, expect, test } from "bun:test";
import { OFFLINE_THRESHOLD_MS } from "@checkstack/satellite-common";
import { computeStatus, resolveOfflineThresholdMs } from "./status";

const agoMs = (ms: number) => new Date(Date.now() - ms);

describe("resolveOfflineThresholdMs", () => {
  test("falls back to the platform default when unset", () => {
    expect(resolveOfflineThresholdMs({})).toBe(OFFLINE_THRESHOLD_MS);
    expect(resolveOfflineThresholdMs({ offlineThresholdMs: null })).toBe(
      OFFLINE_THRESHOLD_MS,
    );
  });

  test("honours a positive override", () => {
    expect(resolveOfflineThresholdMs({ offlineThresholdMs: 600_000 })).toBe(
      600_000,
    );
  });

  test("ignores a non-positive value rather than pinning a satellite offline", () => {
    // A stored 0 or negative would make the satellite permanently offline. The
    // column is a tolerance, not a kill switch.
    expect(resolveOfflineThresholdMs({ offlineThresholdMs: 0 })).toBe(
      OFFLINE_THRESHOLD_MS,
    );
    expect(resolveOfflineThresholdMs({ offlineThresholdMs: -1 })).toBe(
      OFFLINE_THRESHOLD_MS,
    );
  });

  test("ignores a non-finite value", () => {
    expect(
      resolveOfflineThresholdMs({ offlineThresholdMs: Number.NaN }),
    ).toBe(OFFLINE_THRESHOLD_MS);
  });
});

describe("computeStatus", () => {
  test("a satellite that never connected is offline", () => {
    expect(computeStatus({ lastHeartbeatAt: null })).toBe("offline");
  });

  test("a recent heartbeat is online under the default threshold", () => {
    expect(computeStatus({ lastHeartbeatAt: agoMs(5_000) })).toBe("online");
  });

  test("an aged heartbeat is offline under the default threshold", () => {
    expect(
      computeStatus({ lastHeartbeatAt: agoMs(OFFLINE_THRESHOLD_MS + 10_000) }),
    ).toBe("offline");
  });

  test("a longer per-satellite threshold keeps an otherwise-offline satellite online", () => {
    // The whole point of the override: a flaky link gets more grace without
    // loosening every other satellite.
    const lastHeartbeatAt = agoMs(OFFLINE_THRESHOLD_MS + 10_000);

    expect(computeStatus({ lastHeartbeatAt })).toBe("offline");
    expect(
      computeStatus({ lastHeartbeatAt, offlineThresholdMs: 600_000 }),
    ).toBe("online");
  });

  test("a shorter per-satellite threshold reports offline sooner", () => {
    const lastHeartbeatAt = agoMs(30_000);

    expect(computeStatus({ lastHeartbeatAt })).toBe("online");
    expect(
      computeStatus({ lastHeartbeatAt, offlineThresholdMs: 20_000 }),
    ).toBe("offline");
  });

  test("exactly at the threshold still counts as online", () => {
    // The comparison is inclusive; pinning it stops a refactor from silently
    // turning the boundary into a flapping edge.
    const threshold = 60_000;
    expect(
      computeStatus({
        lastHeartbeatAt: new Date(Date.now() - threshold),
        offlineThresholdMs: threshold,
      }),
    ).toBe("online");
  });

  test("null lastHeartbeatAt is offline no matter how generous the threshold", () => {
    expect(
      computeStatus({ lastHeartbeatAt: null, offlineThresholdMs: 86_400_000 }),
    ).toBe("offline");
  });
});

describe("computeStatus - threshold changes take effect immediately", () => {
  /**
   * The threshold is applied at READ time against the stored heartbeat, so
   * changing it re-decides liveness for heartbeats that already happened. That
   * is deliberate and is what an operator expects ("this link is flaky, give it
   * more grace" should fix the false alarm NOW, not after the next heartbeat) -
   * but it is surprising enough to pin.
   */
  const lastHeartbeatAt = agoMs(OFFLINE_THRESHOLD_MS + 60_000);

  test("raising the threshold brings an already-offline satellite back online", () => {
    expect(computeStatus({ lastHeartbeatAt })).toBe("offline");
    expect(
      computeStatus({ lastHeartbeatAt, offlineThresholdMs: 3_600_000 }),
    ).toBe("online");
  });

  test("lowering the threshold takes a healthy satellite offline", () => {
    const recent = agoMs(30_000);
    expect(computeStatus({ lastHeartbeatAt: recent })).toBe("online");
    expect(
      computeStatus({ lastHeartbeatAt: recent, offlineThresholdMs: 20_000 }),
    ).toBe("offline");
  });

  test("a satellite that never connected stays offline at ANY threshold", () => {
    // No heartbeat is not the same as a stale one: no amount of grace turns
    // "never seen" into "online".
    for (const offlineThresholdMs of [20_000, 600_000, 86_400_000]) {
      expect(
        computeStatus({ lastHeartbeatAt: null, offlineThresholdMs }),
      ).toBe("offline");
    }
  });

  test("a future-dated heartbeat reads online rather than wrapping to offline", () => {
    // Clock skew between a satellite and the core can put the timestamp ahead
    // of now. The elapsed time goes negative, which must not underflow into a
    // stale verdict.
    expect(
      computeStatus({ lastHeartbeatAt: new Date(Date.now() + 60_000) }),
    ).toBe("online");
  });
});
