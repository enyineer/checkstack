import { describe, it, expect, beforeEach, mock } from "bun:test";
import { SloEngine } from "./slo-engine";
import type { SloService } from "./service";
import type { SloObjective, SloDowntimeEvent } from "@checkstack/slo-common";

// =============================================================================
// MOCK FACTORIES
// =============================================================================

function createMockSignalService() {
  return {
    broadcast: mock(() => Promise.resolve()),
    subscribe: mock(() => () => {}),
  };
}

function createMockLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  };
}

function createObjective(
  overrides: Partial<SloObjective> = {},
): SloObjective {
  return {
    id: "obj-1",
    systemId: "sys-1",
    // eslint-disable-next-line unicorn/no-null -- Zod schema uses .nullable()
    healthCheckConfigurationId: null,
    target: 99.9,
    windowDays: 30,
    dependencyExclusion: "self-only",
    excludedDependencyIds: undefined,
    burnRateThresholds: {
      warningPercent: 50,
      criticalPercent: 80,
      fastBurnMultiplier: 5,
    },
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function createDowntimeEvent(
  overrides: Partial<SloDowntimeEvent> = {},
): SloDowntimeEvent {
  return {
    id: "evt-1",
    objectiveId: "obj-1",
    systemId: "sys-1",
    startTime: new Date(),
    // eslint-disable-next-line unicorn/no-null -- Zod schema uses .nullable()
    endTime: null,
    // eslint-disable-next-line unicorn/no-null -- Zod schema uses .nullable()
    durationSeconds: null,
    attributionType: "self",
    // eslint-disable-next-line unicorn/no-null -- Zod schema uses .nullable()
    upstreamSystemId: null,
    // eslint-disable-next-line unicorn/no-null -- Zod schema uses .nullable()
    upstreamSystemName: null,
    ...overrides,
  };
}

function createMockService(
  options: {
    objectives?: SloObjective[];
    openEvents?: SloDowntimeEvent[];
    openSelfEvents?: SloDowntimeEvent[];
    openUpstreamEvents?: SloDowntimeEvent[];
  } = {},
) {
  const {
    objectives = [],
    openEvents = [],
    openSelfEvents = [],
    openUpstreamEvents = [],
  } = options;

  return {
    getObjectivesForSystem: mock(() => Promise.resolve(objectives)),
    getObjective: mock(({ id }: { id: string }) =>
      Promise.resolve(objectives.find((o) => o.id === id)),
    ),
    getOpenDowntimeEventsForObjective: mock(() =>
      Promise.resolve(openEvents),
    ),
    getOpenDowntimeEvents: mock(() => Promise.resolve(openEvents)),
    getOpenSelfEvents: mock(() => Promise.resolve(openSelfEvents)),
    getOpenUpstreamEvents: mock(() => Promise.resolve(openUpstreamEvents)),
    openDowntimeEvent: mock(() =>
      Promise.resolve(createDowntimeEvent()),
    ),
    closeDowntimeEvent: mock(() =>
      Promise.resolve(createDowntimeEvent({ endTime: new Date(), durationSeconds: 60 })),
    ),
    getDowntimeForWindow: mock(() =>
      Promise.resolve({
        totalMinutes: 0,
        selfMinutes: 0,
        upstreamMinutes: 0,
        entries: [],
      }),
    ),
    listObjectives: mock(() => Promise.resolve(objectives)),
    getStreak: mock(() => Promise.resolve(undefined)),
    insertDailySnapshot: mock(() => Promise.resolve()),
    incrementStreak: mock(() => Promise.resolve()),
    resetStreak: mock(() => Promise.resolve()),
    getRecentDowntimeEvents: mock(() => Promise.resolve([])),
    unlockAchievement: mock(() => Promise.resolve(undefined)),
    hasAchievement: mock(() => Promise.resolve(false)),
    getAchievements: mock(() => Promise.resolve([])),
  } as unknown as SloService;
}

// =============================================================================
// TESTS
// =============================================================================

describe("SloEngine", () => {
  let engine: SloEngine;
  let mockService: SloService;
  let mockSignalService: ReturnType<typeof createMockSignalService>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  const alwaysHealthy = async () => ({
    isHealthy: true,
    systemName: "upstream",
  });
  const alwaysUnhealthy = async () => ({
    isHealthy: false,
    systemName: "upstream",
  });
  // Suppress unused variable lint — kept for future tests
  void alwaysUnhealthy;

  describe("handleSystemDown", () => {
    it("should open a downtime event for each objective on the system", async () => {
      const objective = createObjective();
      mockService = createMockService({ objectives: [objective] });
      mockSignalService = createMockSignalService();
      mockLogger = createMockLogger();

      engine = new SloEngine({
        service: mockService,
        signalService: mockSignalService as never,
        logger: mockLogger as never,
      });

      await engine.handleSystemDown({
        systemId: "sys-1",
        getUpstreamHealthStatus: alwaysHealthy,
      });

      expect(mockService.openDowntimeEvent).toHaveBeenCalledTimes(1);
      expect(mockService.openDowntimeEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          objectiveId: "obj-1",
          systemId: "sys-1",
          attributionType: "self",
        }),
      );
    });

    it("should skip opening if there is already an open event (idempotent)", async () => {
      const objective = createObjective();
      const existingEvent = createDowntimeEvent();
      mockService = createMockService({
        objectives: [objective],
        openEvents: [existingEvent],
      });
      mockSignalService = createMockSignalService();
      mockLogger = createMockLogger();

      engine = new SloEngine({
        service: mockService,
        signalService: mockSignalService as never,
        logger: mockLogger as never,
      });

      await engine.handleSystemDown({
        systemId: "sys-1",
        getUpstreamHealthStatus: alwaysHealthy,
      });

      expect(mockService.openDowntimeEvent).not.toHaveBeenCalled();
    });

    it("should open multiple events for multiple objectives", async () => {
      const obj1 = createObjective({ id: "obj-1" });
      const obj2 = createObjective({ id: "obj-2" });
      mockService = createMockService({ objectives: [obj1, obj2] });
      mockSignalService = createMockSignalService();
      mockLogger = createMockLogger();

      engine = new SloEngine({
        service: mockService,
        signalService: mockSignalService as never,
        logger: mockLogger as never,
      });

      await engine.handleSystemDown({
        systemId: "sys-1",
        getUpstreamHealthStatus: alwaysHealthy,
      });

      expect(mockService.openDowntimeEvent).toHaveBeenCalledTimes(2);
    });

    it("should always attribute as 'self' in strict mode", async () => {
      const objective = createObjective({ dependencyExclusion: "strict" });
      mockService = createMockService({ objectives: [objective] });
      mockSignalService = createMockSignalService();
      mockLogger = createMockLogger();

      engine = new SloEngine({
        service: mockService,
        signalService: mockSignalService as never,
        logger: mockLogger as never,
      });

      await engine.handleSystemDown({
        systemId: "sys-1",
        getUpstreamHealthStatus: alwaysUnhealthy,
      });

      expect(mockService.openDowntimeEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          attributionType: "self",
        }),
      );
    });
  });

  describe("handleSystemUp", () => {
    it("should close all open downtime events for the system", async () => {
      const evt1 = createDowntimeEvent({ id: "evt-1", objectiveId: "obj-1" });
      const evt2 = createDowntimeEvent({ id: "evt-2", objectiveId: "obj-1" });
      const objective = createObjective();
      mockService = createMockService({
        objectives: [objective],
        openEvents: [evt1, evt2],
      });
      mockSignalService = createMockSignalService();
      mockLogger = createMockLogger();

      engine = new SloEngine({
        service: mockService,
        signalService: mockSignalService as never,
        logger: mockLogger as never,
      });

      await engine.handleSystemUp({ systemId: "sys-1" });

      expect(mockService.closeDowntimeEvent).toHaveBeenCalledTimes(2);
    });

    it("should broadcast SLO_STATUS_CHANGED for affected objectives", async () => {
      const evt = createDowntimeEvent({ objectiveId: "obj-1" });
      const objective = createObjective();
      mockService = createMockService({
        objectives: [objective],
        openEvents: [evt],
      });
      mockSignalService = createMockSignalService();
      mockLogger = createMockLogger();

      engine = new SloEngine({
        service: mockService,
        signalService: mockSignalService as never,
        logger: mockLogger as never,
      });

      await engine.handleSystemUp({ systemId: "sys-1" });

      expect(mockSignalService.broadcast).toHaveBeenCalledWith(
        expect.objectContaining({ id: "slo.status.changed" }),
        expect.objectContaining({
          systemId: "sys-1",
          objectiveId: "obj-1",
        }),
      );
    });

    it("should do nothing if no open events exist", async () => {
      mockService = createMockService();
      mockSignalService = createMockSignalService();
      mockLogger = createMockLogger();

      engine = new SloEngine({
        service: mockService,
        signalService: mockSignalService as never,
        logger: mockLogger as never,
      });

      await engine.handleSystemUp({ systemId: "sys-1" });

      expect(mockService.closeDowntimeEvent).not.toHaveBeenCalled();
      expect(mockSignalService.broadcast).not.toHaveBeenCalled();
    });
  });

  describe("handleUpstreamDown", () => {
    it("should split open self events into upstream events", async () => {
      const selfEvent = createDowntimeEvent({
        id: "evt-self",
        objectiveId: "obj-1",
        attributionType: "self",
      });
      const objective = createObjective({ dependencyExclusion: "self-only" });
      mockService = createMockService({
        objectives: [objective],
        openSelfEvents: [selfEvent],
      });
      mockSignalService = createMockSignalService();
      mockLogger = createMockLogger();

      engine = new SloEngine({
        service: mockService,
        signalService: mockSignalService as never,
        logger: mockLogger as never,
      });

      await engine.handleUpstreamDown({
        upstreamSystemId: "upstream-1",
        upstreamSystemName: "Upstream Service",
        downstreamSystemIds: ["sys-1"],
      });

      // Should close the self event
      expect(mockService.closeDowntimeEvent).toHaveBeenCalledWith({
        id: "evt-self",
      });

      // Should open a new upstream event
      expect(mockService.openDowntimeEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          attributionType: "upstream",
          upstreamSystemId: "upstream-1",
          upstreamSystemName: "Upstream Service",
        }),
      );
    });

    it("should skip splitting for strict mode objectives", async () => {
      const selfEvent = createDowntimeEvent({
        id: "evt-self",
        attributionType: "self",
      });
      const objective = createObjective({ dependencyExclusion: "strict" });
      mockService = createMockService({
        objectives: [objective],
        openSelfEvents: [selfEvent],
      });
      mockSignalService = createMockSignalService();
      mockLogger = createMockLogger();

      engine = new SloEngine({
        service: mockService,
        signalService: mockSignalService as never,
        logger: mockLogger as never,
      });

      await engine.handleUpstreamDown({
        upstreamSystemId: "upstream-1",
        upstreamSystemName: "Upstream",
        downstreamSystemIds: ["sys-1"],
      });

      expect(mockService.closeDowntimeEvent).not.toHaveBeenCalled();
      expect(mockService.openDowntimeEvent).not.toHaveBeenCalled();
    });

    it("should skip splitting if upstream is in excluded dependencies", async () => {
      const selfEvent = createDowntimeEvent({
        id: "evt-self",
        attributionType: "self",
      });
      const objective = createObjective({
        dependencyExclusion: "self-only",
        excludedDependencyIds: ["upstream-excluded"],
      });
      mockService = createMockService({
        objectives: [objective],
        openSelfEvents: [selfEvent],
      });
      mockSignalService = createMockSignalService();
      mockLogger = createMockLogger();

      engine = new SloEngine({
        service: mockService,
        signalService: mockSignalService as never,
        logger: mockLogger as never,
      });

      await engine.handleUpstreamDown({
        upstreamSystemId: "upstream-excluded",
        upstreamSystemName: "Excluded Upstream",
        downstreamSystemIds: ["sys-1"],
      });

      expect(mockService.closeDowntimeEvent).not.toHaveBeenCalled();
    });
  });

  describe("handleUpstreamUp", () => {
    it("should close upstream events and open new self events when downstream still down", async () => {
      const upstreamEvent = createDowntimeEvent({
        id: "evt-upstream",
        objectiveId: "obj-1",
        attributionType: "upstream",
        upstreamSystemId: "upstream-1",
      });
      const objective = createObjective();
      mockService = createMockService({
        objectives: [objective],
        openUpstreamEvents: [upstreamEvent],
      });
      mockSignalService = createMockSignalService();
      mockLogger = createMockLogger();

      // After closing the upstream event, getOpenDowntimeEventsForObjective
      // should return [] — meaning no other open events remain, so the
      // downstream must still be down and needs re-attribution
      (mockService.getOpenDowntimeEventsForObjective as ReturnType<typeof mock>)
        .mockResolvedValue([]);

      engine = new SloEngine({
        service: mockService,
        signalService: mockSignalService as never,
        logger: mockLogger as never,
      });

      await engine.handleUpstreamUp({
        upstreamSystemId: "upstream-1",
        downstreamSystemIds: ["sys-1"],
        getUpstreamHealthStatus: alwaysHealthy,
      });

      // Should close the upstream event
      expect(mockService.closeDowntimeEvent).toHaveBeenCalledWith({
        id: "evt-upstream",
      });

      // Should open a new event (re-attributed)
      expect(mockService.openDowntimeEvent).toHaveBeenCalled();
    });
  });

  describe("computeStatus", () => {
    it("should calculate correct availability for zero downtime", async () => {
      const objective = createObjective({ target: 99.9, windowDays: 30 });
      mockService = createMockService({ objectives: [objective] });
      mockSignalService = createMockSignalService();
      mockLogger = createMockLogger();

      engine = new SloEngine({
        service: mockService,
        signalService: mockSignalService as never,
        logger: mockLogger as never,
      });

      const status = await engine.computeStatus({ objective });

      expect(status.errorBudgetConsumedMinutes).toBe(0);
      expect(status.errorBudgetRemainingPercent).toBe(100);
      expect(status.isBreaching).toBe(false);
    });

    it("should count only selfMinutes for self-only mode", async () => {
      const objective = createObjective({
        target: 99.9,
        windowDays: 30,
        dependencyExclusion: "self-only",
      });
      mockService = createMockService({ objectives: [objective] });

      // Mock downtime: 10 min self + 20 min upstream
      (mockService.getDowntimeForWindow as ReturnType<typeof mock>).mockResolvedValue({
        totalMinutes: 30,
        selfMinutes: 10,
        upstreamMinutes: 20,
        entries: [],
      });

      mockSignalService = createMockSignalService();
      mockLogger = createMockLogger();

      engine = new SloEngine({
        service: mockService,
        signalService: mockSignalService as never,
        logger: mockLogger as never,
      });

      const status = await engine.computeStatus({ objective });

      // Should only count 10 self minutes
      expect(status.errorBudgetConsumedMinutes).toBe(10);
      // Strict should count all 30
      expect(status.errorBudgetConsumedStrictMinutes).toBe(30);
    });

    it("should count totalMinutes for strict mode", async () => {
      const objective = createObjective({
        target: 99.9,
        windowDays: 30,
        dependencyExclusion: "strict",
      });
      mockService = createMockService({ objectives: [objective] });

      (mockService.getDowntimeForWindow as ReturnType<typeof mock>).mockResolvedValue({
        totalMinutes: 30,
        selfMinutes: 10,
        upstreamMinutes: 20,
        entries: [],
      });

      mockSignalService = createMockSignalService();
      mockLogger = createMockLogger();

      engine = new SloEngine({
        service: mockService,
        signalService: mockSignalService as never,
        logger: mockLogger as never,
      });

      const status = await engine.computeStatus({ objective });

      // Strict counts all downtime
      expect(status.errorBudgetConsumedMinutes).toBe(30);
    });

    it("should flag as breaching when availability is below target", async () => {
      const objective = createObjective({
        target: 99.9,
        windowDays: 30,
      });
      mockService = createMockService({ objectives: [objective] });

      // 99.9% of 30 days = 43,200 minutes → allowed downtime = 43.2 min
      // Set consumed = 50 min → breaching
      (mockService.getDowntimeForWindow as ReturnType<typeof mock>).mockResolvedValue({
        totalMinutes: 50,
        selfMinutes: 50,
        upstreamMinutes: 0,
        entries: [],
      });

      mockSignalService = createMockSignalService();
      mockLogger = createMockLogger();

      engine = new SloEngine({
        service: mockService,
        signalService: mockSignalService as never,
        logger: mockLogger as never,
      });

      const status = await engine.computeStatus({ objective });

      expect(status.isBreaching).toBe(true);
    });
  });

  describe("reconcileObjective", () => {
    it("should open a downtime event when system is already unhealthy", async () => {
      const objective = createObjective();
      mockService = createMockService({ objectives: [objective] });
      mockSignalService = createMockSignalService();
      mockLogger = createMockLogger();

      engine = new SloEngine({
        service: mockService,
        signalService: mockSignalService as never,
        logger: mockLogger as never,
      });

      engine.setHealthStatusCallback(async () => ({
        isHealthy: false,
      }));

      await engine.reconcileObjective({ objective });

      expect(mockService.openDowntimeEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          objectiveId: "obj-1",
          systemId: "sys-1",
          attributionType: "self",
        }),
      );
    });

    it("should skip when system is healthy", async () => {
      const objective = createObjective();
      mockService = createMockService({ objectives: [objective] });
      mockSignalService = createMockSignalService();
      mockLogger = createMockLogger();

      engine = new SloEngine({
        service: mockService,
        signalService: mockSignalService as never,
        logger: mockLogger as never,
      });

      engine.setHealthStatusCallback(async () => ({
        isHealthy: true,
      }));

      await engine.reconcileObjective({ objective });

      expect(mockService.openDowntimeEvent).not.toHaveBeenCalled();
    });

    it("should skip gracefully when no callback is set", async () => {
      const objective = createObjective();
      mockService = createMockService({ objectives: [objective] });
      mockSignalService = createMockSignalService();
      mockLogger = createMockLogger();

      engine = new SloEngine({
        service: mockService,
        signalService: mockSignalService as never,
        logger: mockLogger as never,
      });

      // No setHealthStatusCallback call — should not throw
      await engine.reconcileObjective({ objective });

      expect(mockService.openDowntimeEvent).not.toHaveBeenCalled();
    });

    it("should skip when open events already exist (idempotent)", async () => {
      const objective = createObjective();
      const existingEvent = createDowntimeEvent();
      mockService = createMockService({
        objectives: [objective],
        openEvents: [existingEvent],
      });
      mockSignalService = createMockSignalService();
      mockLogger = createMockLogger();

      engine = new SloEngine({
        service: mockService,
        signalService: mockSignalService as never,
        logger: mockLogger as never,
      });

      engine.setHealthStatusCallback(async () => ({
        isHealthy: false,
      }));

      await engine.reconcileObjective({ objective });

      expect(mockService.openDowntimeEvent).not.toHaveBeenCalled();
    });
  });
});
