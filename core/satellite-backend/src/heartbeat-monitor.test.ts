import { describe, it, expect, mock, beforeEach } from "bun:test";
import {
  HeartbeatMonitor,
  type SatelliteHeartbeatEntitySink,
} from "./heartbeat-monitor";
import {
  createMockLogger,
  createMockSignalService,
  type MockSignalService,
} from "@checkstack/test-utils-backend";
import {
  SATELLITE_STATUS_CHANGED,
  OFFLINE_THRESHOLD_MS,
} from "@checkstack/satellite-common";
import type { SatelliteService } from "./service";
import type { SatelliteConnectionEvent } from "./entity";

type LivenessRow = {
  id: string;
  name: string;
  region: string;
  lastHeartbeatAt: Date | null;
  lastConnectionEvent: SatelliteConnectionEvent | null;
};

function makeEntitySink(): {
  sink: SatelliteHeartbeatEntitySink;
  mirrors: string[];
} {
  const mirrors: string[] = [];
  return {
    sink: {
      mirror: mock(async (id: string) => {
        mirrors.push(id);
      }),
    },
    mirrors,
  };
}

/**
 * Mock the service's durable liveness read. The array is captured by reference
 * so a test can mutate it (e.g. flip `lastConnectionEvent` to "heartbeat_lost"
 * to simulate the idempotent durable write) between `checkHeartbeats` calls.
 */
const createMockSatelliteService = (rows: LivenessRow[]): SatelliteService =>
  ({
    listConnectionLiveness: mock(async () => rows),
  }) as unknown as SatelliteService;

const recentHeartbeat = () => new Date(Date.now() - 5_000);
const agedHeartbeat = () => new Date(Date.now() - OFFLINE_THRESHOLD_MS - 10_000);

describe("HeartbeatMonitor", () => {
  let signalService: MockSignalService;
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    signalService = createMockSignalService();
    logger = createMockLogger();
  });

  it("does NOT detect a lost edge for an online (recent heartbeat) satellite", async () => {
    const service = createMockSatelliteService([
      {
        id: "sat-1",
        name: "eu-west",
        region: "eu-west-1",
        lastHeartbeatAt: recentHeartbeat(),
        lastConnectionEvent: "connected",
      },
    ]);
    const { sink, mirrors } = makeEntitySink();
    const monitor = new HeartbeatMonitor(service, signalService, logger, sink);

    await monitor.checkHeartbeats();

    expect(mirrors).toHaveLength(0);
    expect(signalService.getRecordedSignals()).toHaveLength(0);
  });

  it("detects heartbeat_lost from DURABLE state with NO prior in-memory knowledge", async () => {
    // The core horizontal-scale property: a fresh monitor (empty heap, as on a
    // pod that never saw this satellite online) still detects the online→offline
    // edge purely from the durable (agedHeartbeat + lastConnectionEvent:
    // "connected") row, mirrors heartbeat_lost, and broadcasts.
    const service = createMockSatelliteService([
      {
        id: "sat-1",
        name: "eu-west",
        region: "eu-west-1",
        lastHeartbeatAt: agedHeartbeat(),
        lastConnectionEvent: "connected",
      },
    ]);
    const { sink, mirrors } = makeEntitySink();
    const monitor = new HeartbeatMonitor(service, signalService, logger, sink);

    await monitor.checkHeartbeats();

    expect(mirrors).toEqual(["sat-1"]);

    const recorded = signalService.getRecordedSignalsById(
      SATELLITE_STATUS_CHANGED.id,
    );
    expect(recorded).toHaveLength(1);
    expect(recorded[0].payload).toEqual({
      satelliteId: "sat-1",
      status: "offline",
      name: "eu-west",
      region: "eu-west-1",
    });
  });

  it("is idempotent: re-running after the durable flip is a no-op (any pod, redelivery)", async () => {
    const rows: LivenessRow[] = [
      {
        id: "sat-1",
        name: "eu-west",
        region: "eu-west-1",
        lastHeartbeatAt: agedHeartbeat(),
        lastConnectionEvent: "connected",
      },
    ];
    const service = createMockSatelliteService(rows);
    const { sink, mirrors } = makeEntitySink();
    const monitor = new HeartbeatMonitor(service, signalService, logger, sink);

    // First check detects + mirrors the edge.
    await monitor.checkHeartbeats();
    expect(mirrors).toEqual(["sat-1"]);

    // Simulate the durable write the mirror performed: lastConnectionEvent is
    // now "heartbeat_lost". A re-run (same pod OR another pod, since the
    // predicate is over durable state) detects nothing more.
    rows[0] = { ...rows[0], lastConnectionEvent: "heartbeat_lost" };
    await monitor.checkHeartbeats();
    expect(mirrors).toEqual(["sat-1"]); // still just one

    // A SECOND pod with a fresh (empty) monitor likewise sees a no-op.
    const { sink: sink2, mirrors: mirrors2 } = makeEntitySink();
    const monitor2 = new HeartbeatMonitor(service, signalService, logger, sink2);
    await monitor2.checkHeartbeats();
    expect(mirrors2).toHaveLength(0);
  });

  it("does NOT mirror the offline→online edge (the WS handler owns reconnect)", async () => {
    // A satellite that reconnected: recent heartbeat, lastConnectionEvent already
    // "connected". Nothing for the monitor to do — and crucially it must not
    // treat a heartbeat_lost→connected transition as a lost edge.
    const service = createMockSatelliteService([
      {
        id: "sat-1",
        name: "eu-west",
        region: "eu-west-1",
        lastHeartbeatAt: recentHeartbeat(),
        lastConnectionEvent: "connected",
      },
    ]);
    const { sink, mirrors } = makeEntitySink();
    const monitor = new HeartbeatMonitor(service, signalService, logger, sink);

    await monitor.checkHeartbeats();
    expect(mirrors).toHaveLength(0);
  });

  it("does NOT detect a lost edge for a cleanly-disconnected satellite", async () => {
    // Clean disconnect already set lastConnectionEvent="disconnected" and nulled
    // the heartbeat: status is offline, but the edge was already recorded, so the
    // monitor must not re-fire heartbeat_lost.
    const service = createMockSatelliteService([
      {
        id: "sat-1",
        name: "eu-west",
        region: "eu-west-1",
        lastHeartbeatAt: null,
        lastConnectionEvent: "disconnected",
      },
    ]);
    const { sink, mirrors } = makeEntitySink();
    const monitor = new HeartbeatMonitor(service, signalService, logger, sink);

    await monitor.checkHeartbeats();
    expect(mirrors).toHaveLength(0);
    expect(signalService.getRecordedSignals()).toHaveLength(0);
  });

  it("does NOT detect a lost edge for a never-connected satellite", async () => {
    const service = createMockSatelliteService([
      {
        id: "sat-1",
        name: "eu-west",
        region: "eu-west-1",
        lastHeartbeatAt: null,
        lastConnectionEvent: null,
      },
    ]);
    const { sink, mirrors } = makeEntitySink();
    const monitor = new HeartbeatMonitor(service, signalService, logger, sink);

    await monitor.checkHeartbeats();
    expect(mirrors).toHaveLength(0);
    expect(signalService.getRecordedSignals()).toHaveLength(0);
  });

  it("broadcasts the offline edge only once per pod across back-to-back checks", async () => {
    const rows: LivenessRow[] = [
      {
        id: "sat-1",
        name: "eu-west",
        region: "eu-west-1",
        lastHeartbeatAt: agedHeartbeat(),
        lastConnectionEvent: "connected",
      },
    ];
    const service = createMockSatelliteService(rows);
    const { sink } = makeEntitySink();
    const monitor = new HeartbeatMonitor(service, signalService, logger, sink);

    // Two checks BEFORE the durable flip lands (e.g. mirror failed once). The
    // broadcast-dedup set suppresses a second broadcast from THIS pod.
    await monitor.checkHeartbeats();
    await monitor.checkHeartbeats();

    expect(
      signalService.getRecordedSignalsById(SATELLITE_STATUS_CHANGED.id),
    ).toHaveLength(1);
  });

  it("works without an entity sink (broadcast-only)", async () => {
    const service = createMockSatelliteService([
      {
        id: "sat-1",
        name: "eu-west",
        region: "eu-west-1",
        lastHeartbeatAt: agedHeartbeat(),
        lastConnectionEvent: "connected",
      },
    ]);
    const monitor = new HeartbeatMonitor(service, signalService, logger);

    await monitor.checkHeartbeats();

    expect(
      signalService.wasSignalEmitted(SATELLITE_STATUS_CHANGED.id),
    ).toBe(true);
  });
});
