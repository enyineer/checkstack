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
import { SATELLITE_STATUS_CHANGED } from "@checkstack/satellite-common";
import type { SatelliteService } from "./service";
import type { SatelliteConnectionState } from "./entity";
import type { SatelliteWithStatus } from "@checkstack/satellite-common";

function makeEntitySink(): {
  sink: SatelliteHeartbeatEntitySink;
  mirrors: Array<{ id: string; state: SatelliteConnectionState }>;
} {
  const mirrors: Array<{ id: string; state: SatelliteConnectionState }> = [];
  return {
    sink: {
      mirror: mock(async (id: string, state: SatelliteConnectionState) => {
        mirrors.push({ id, state });
      }),
    },
    mirrors,
  };
}

const createMockSatelliteService = (
  satellites: SatelliteWithStatus[],
): SatelliteService =>
  ({
    listSatellites: mock(async () => satellites),
  }) as unknown as SatelliteService;

describe("HeartbeatMonitor", () => {
  let signalService: MockSignalService;
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    signalService = createMockSignalService();
    logger = createMockLogger();
  });

  it("should not broadcast signals on first check (initialization)", async () => {
    const service = createMockSatelliteService([
      {
        id: "sat-1",
        name: "eu-west",
        region: "eu-west-1",
        tags: {},
        status: "online",
        createdAt: new Date(),
      },
    ]);

    const monitor = new HeartbeatMonitor(service, signalService, logger);
    await monitor.checkHeartbeats();

    // First check should NOT broadcast — it only initializes state
    expect(signalService.getRecordedSignals()).toHaveLength(0);
  });

  it("should broadcast when a satellite goes offline", async () => {
    const satellites: SatelliteWithStatus[] = [
      {
        id: "sat-1",
        name: "eu-west",
        region: "eu-west-1",
        tags: {},
        status: "online",
        createdAt: new Date(),
      },
    ];
    const service = createMockSatelliteService(satellites);
    const monitor = new HeartbeatMonitor(service, signalService, logger);

    // First check: initialize state
    await monitor.checkHeartbeats();

    // Simulate satellite going offline
    satellites[0] = { ...satellites[0], status: "offline" };
    await monitor.checkHeartbeats();

    expect(
      signalService.wasSignalEmitted(SATELLITE_STATUS_CHANGED.id),
    ).toBe(true);

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

  it("should broadcast when a satellite comes back online", async () => {
    const satellites: SatelliteWithStatus[] = [
      {
        id: "sat-1",
        name: "eu-west",
        region: "eu-west-1",
        tags: {},
        status: "offline",
        createdAt: new Date(),
      },
    ];
    const service = createMockSatelliteService(satellites);
    const monitor = new HeartbeatMonitor(service, signalService, logger);

    // First check: initialize state
    await monitor.checkHeartbeats();

    // Simulate satellite coming online
    satellites[0] = { ...satellites[0], status: "online" };
    await monitor.checkHeartbeats();

    const recorded = signalService.getRecordedSignalsById(
      SATELLITE_STATUS_CHANGED.id,
    );
    expect(recorded).toHaveLength(1);
    expect(recorded[0].payload).toEqual({
      satelliteId: "sat-1",
      status: "online",
      name: "eu-west",
      region: "eu-west-1",
    });
  });

  it("should not broadcast if status stays the same", async () => {
    const satellites: SatelliteWithStatus[] = [
      {
        id: "sat-1",
        name: "eu-west",
        region: "eu-west-1",
        tags: {},
        status: "online",
        createdAt: new Date(),
      },
    ];
    const service = createMockSatelliteService(satellites);
    const monitor = new HeartbeatMonitor(service, signalService, logger);

    // First check: initialize
    await monitor.checkHeartbeats();
    // Second check: same status
    await monitor.checkHeartbeats();

    expect(signalService.getRecordedSignals()).toHaveLength(0);
  });

  it("mirrors offline/heartbeat_lost on the online → offline edge", async () => {
    const satellites: SatelliteWithStatus[] = [
      {
        id: "sat-1",
        name: "eu-west",
        region: "eu-west-1",
        tags: {},
        status: "online",
        createdAt: new Date(),
      },
    ];
    const service = createMockSatelliteService(satellites);
    const { sink, mirrors } = makeEntitySink();
    const monitor = new HeartbeatMonitor(service, signalService, logger, sink);

    await monitor.checkHeartbeats(); // initialize
    satellites[0] = { ...satellites[0], status: "offline" };
    await monitor.checkHeartbeats();

    expect(mirrors).toHaveLength(1);
    expect(mirrors[0]!.id).toBe("sat-1");
    expect(mirrors[0]!.state.status).toBe("offline");
    expect(mirrors[0]!.state.lastEvent).toBe("heartbeat_lost");
    expect(mirrors[0]!.state.name).toBe("eu-west");
    expect(mirrors[0]!.state.region).toBe("eu-west-1");
  });

  it("does NOT mirror on the offline → online edge (the WS handler owns reconnect)", async () => {
    const satellites: SatelliteWithStatus[] = [
      {
        id: "sat-1",
        name: "eu-west",
        region: "eu-west-1",
        tags: {},
        status: "offline",
        createdAt: new Date(),
      },
    ];
    const service = createMockSatelliteService(satellites);
    const { sink, mirrors } = makeEntitySink();
    const monitor = new HeartbeatMonitor(service, signalService, logger, sink);

    await monitor.checkHeartbeats(); // initialize
    satellites[0] = { ...satellites[0], status: "online" };
    await monitor.checkHeartbeats();

    expect(mirrors).toHaveLength(0);
  });

  it("should clean up tracked state for deleted satellites", async () => {
    const satellites: SatelliteWithStatus[] = [
      {
        id: "sat-1",
        name: "eu-west",
        region: "eu-west-1",
        tags: {},
        status: "online",
        createdAt: new Date(),
      },
    ];
    const service = createMockSatelliteService(satellites);
    const monitor = new HeartbeatMonitor(service, signalService, logger);

    // First check
    await monitor.checkHeartbeats();

    // Satellite removed (empty list returned)
    satellites.length = 0;
    await monitor.checkHeartbeats();

    // Adding it back should not trigger a transition
    // (it's treated as a new satellite on first check)
    satellites.push({
      id: "sat-1",
      name: "eu-west",
      region: "eu-west-1",
      tags: {},
      status: "online",
      createdAt: new Date(),
    });
    await monitor.checkHeartbeats();

    // No transition signal should have been emitted for the re-add
    expect(signalService.getRecordedSignals()).toHaveLength(0);
  });
});
