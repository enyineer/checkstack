import { describe, it, expect, beforeEach, mock } from "bun:test";
import { SloEngine } from "./slo-engine";
import type { SloService } from "./service";
import { aggregateWindowedDowntime } from "./downtime-window";
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
    excludeMaintenanceWindows: false,
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
    deleteDowntimeEvent: mock(() => Promise.resolve()),
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

    it("should NOT flag hasOpenDowntime for an open upstream event in self-only mode", async () => {
      // Regression: an open upstream event must not flip a self-only objective
      // to "degraded" when no self downtime is counted — otherwise the SLO
      // reads 100% available + degraded at the same time, which must not happen.
      const objective = createObjective({
        target: 99.9,
        windowDays: 30,
        dependencyExclusion: "self-only",
      });
      const openUpstream = createDowntimeEvent({
        attributionType: "upstream",
        upstreamSystemId: "up-1",
      });
      mockService = createMockService({
        objectives: [objective],
        openEvents: [openUpstream],
      });
      mockSignalService = createMockSignalService();
      mockLogger = createMockLogger();

      engine = new SloEngine({
        service: mockService,
        signalService: mockSignalService as never,
        logger: mockLogger as never,
      });

      const status = await engine.computeStatus({ objective });

      expect(status.currentAvailability).toBe(100);
      expect(status.errorBudgetRemainingPercent).toBe(100);
      // Self-only: an upstream-attributed open event is excluded from budget,
      // so it must not report open (budget-relevant) downtime.
      expect(status.hasOpenDowntime).toBe(false);
    });

    it("should flag hasOpenDowntime for an open self event in self-only mode", async () => {
      const objective = createObjective({ dependencyExclusion: "self-only" });
      const openSelf = createDowntimeEvent({ attributionType: "self" });
      mockService = createMockService({
        objectives: [objective],
        openEvents: [openSelf],
      });
      mockSignalService = createMockSignalService();
      mockLogger = createMockLogger();

      engine = new SloEngine({
        service: mockService,
        signalService: mockSignalService as never,
        logger: mockLogger as never,
      });

      const status = await engine.computeStatus({ objective });

      expect(status.hasOpenDowntime).toBe(true);
    });

    it("should flag hasOpenDowntime for any open event in strict mode", async () => {
      const objective = createObjective({ dependencyExclusion: "strict" });
      const openUpstream = createDowntimeEvent({
        attributionType: "upstream",
        upstreamSystemId: "up-1",
      });
      mockService = createMockService({
        objectives: [objective],
        openEvents: [openUpstream],
      });
      mockSignalService = createMockSignalService();
      mockLogger = createMockLogger();

      engine = new SloEngine({
        service: mockService,
        signalService: mockSignalService as never,
        logger: mockLogger as never,
      });

      const status = await engine.computeStatus({ objective });

      expect(status.hasOpenDowntime).toBe(true);
    });

    it("live health is authoritative: a HEALTHY system with an open event is not degraded and excludes it from the budget", async () => {
      // The dashboard "ongoing while healthy" regression: an orphaned open
      // event (missed recovery) must not flip a currently-healthy SLO to
      // degraded/breaching. computeStatus must ask the open path NOT to count
      // open downtime when the system is healthy.
      const objective = createObjective({ dependencyExclusion: "self-only" });
      const openSelf = createDowntimeEvent({ attributionType: "self" });
      mockService = createMockService({
        objectives: [objective],
        openEvents: [openSelf],
      });
      mockSignalService = createMockSignalService();
      mockLogger = createMockLogger();

      engine = new SloEngine({
        service: mockService,
        signalService: mockSignalService as never,
        logger: mockLogger as never,
      });
      engine.setHealthStatusCallback(async () => ({ isHealthy: true }));

      const status = await engine.computeStatus({ objective });

      expect(status.hasOpenDowntime).toBe(false);
      expect(mockService.getDowntimeForWindow).toHaveBeenCalledWith(
        expect.objectContaining({ includeOpen: false }),
      );
    });

    it("live health is authoritative: a DOWN system with an open event counts it and is degraded", async () => {
      const objective = createObjective({ dependencyExclusion: "self-only" });
      const openSelf = createDowntimeEvent({ attributionType: "self" });
      mockService = createMockService({
        objectives: [objective],
        openEvents: [openSelf],
      });
      mockSignalService = createMockSignalService();
      mockLogger = createMockLogger();

      engine = new SloEngine({
        service: mockService,
        signalService: mockSignalService as never,
        logger: mockLogger as never,
      });
      engine.setHealthStatusCallback(async () => ({ isHealthy: false }));

      const status = await engine.computeStatus({ objective });

      expect(status.hasOpenDowntime).toBe(true);
      expect(mockService.getDowntimeForWindow).toHaveBeenCalledWith(
        expect.objectContaining({ includeOpen: true }),
      );
    });

    it("skips the health check entirely when there are no open events", async () => {
      const objective = createObjective();
      mockService = createMockService({ objectives: [objective] });
      mockSignalService = createMockSignalService();
      mockLogger = createMockLogger();

      const healthCallback = mock(async () => ({ isHealthy: true }));
      engine = new SloEngine({
        service: mockService,
        signalService: mockSignalService as never,
        logger: mockLogger as never,
      });
      engine.setHealthStatusCallback(healthCallback);

      await engine.computeStatus({ objective });

      expect(healthCallback).not.toHaveBeenCalled();
      expect(mockService.getDowntimeForWindow).toHaveBeenCalledWith(
        expect.objectContaining({ includeOpen: false }),
      );
    });
  });

  describe("reconcileOrphanedDowntime", () => {
    it("closes the orphan at the ACTUAL recovery time when resolvable (preserves real downtime)", async () => {
      const objective = createObjective();
      const start = new Date("2026-05-26T11:22:00Z");
      const recovery = new Date("2026-06-20T13:00:00Z");
      const orphan = createDowntimeEvent({ id: "orphan-1", startTime: start });
      mockService = createMockService({
        objectives: [objective],
        openEvents: [orphan],
      });
      mockSignalService = createMockSignalService();
      mockLogger = createMockLogger();

      engine = new SloEngine({
        service: mockService,
        signalService: mockSignalService as never,
        logger: mockLogger as never,
      });
      engine.setHealthStatusCallback(async () => ({ isHealthy: true }));
      engine.setRecoveryTimeResolver(async () => recovery);

      await engine.reconcileOrphanedDowntime({ objective });

      // Closed at the real recovery instant, NOT deleted — the genuine downtime
      // between start and recovery is recorded against the budget.
      expect(mockService.closeDowntimeEvent).toHaveBeenCalledWith({
        id: "orphan-1",
        endTime: recovery,
      });
      expect(mockService.deleteDowntimeEvent).not.toHaveBeenCalled();
    });

    it("deletes the orphan only as a fallback when the recovery time can't be resolved", async () => {
      const objective = createObjective();
      const orphan = createDowntimeEvent({ id: "orphan-1" });
      mockService = createMockService({
        objectives: [objective],
        openEvents: [orphan],
      });
      mockSignalService = createMockSignalService();
      mockLogger = createMockLogger();

      engine = new SloEngine({
        service: mockService,
        signalService: mockSignalService as never,
        logger: mockLogger as never,
      });
      engine.setHealthStatusCallback(async () => ({ isHealthy: true }));
      // No recovery resolver (or it returns null) -> unprovable downtime.
      engine.setRecoveryTimeResolver(async () => null);

      await engine.reconcileOrphanedDowntime({ objective });

      expect(mockService.deleteDowntimeEvent).toHaveBeenCalledWith({
        id: "orphan-1",
      });
      expect(mockService.closeDowntimeEvent).not.toHaveBeenCalled();
    });

    it("keeps open events when the system is genuinely down", async () => {
      const objective = createObjective();
      const openEvent = createDowntimeEvent({ id: "evt-1" });
      mockService = createMockService({
        objectives: [objective],
        openEvents: [openEvent],
      });
      mockSignalService = createMockSignalService();
      mockLogger = createMockLogger();

      engine = new SloEngine({
        service: mockService,
        signalService: mockSignalService as never,
        logger: mockLogger as never,
      });
      engine.setHealthStatusCallback(async () => ({ isHealthy: false }));

      await engine.reconcileOrphanedDowntime({ objective });

      expect(mockService.deleteDowntimeEvent).not.toHaveBeenCalled();
      expect(mockService.closeDowntimeEvent).not.toHaveBeenCalled();
    });

    it("does nothing when there are no open events", async () => {
      const objective = createObjective();
      mockService = createMockService({ objectives: [objective] });
      mockSignalService = createMockSignalService();
      mockLogger = createMockLogger();

      const healthCallback = mock(async () => ({ isHealthy: true }));
      engine = new SloEngine({
        service: mockService,
        signalService: mockSignalService as never,
        logger: mockLogger as never,
      });
      engine.setHealthStatusCallback(healthCallback);

      await engine.reconcileOrphanedDowntime({ objective });

      expect(healthCallback).not.toHaveBeenCalled();
      expect(mockService.deleteDowntimeEvent).not.toHaveBeenCalled();
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

// =============================================================================
// Maintenance-window exclusion (engine wiring)
//
// These exercise the REAL path computeStatus -> maintenance resolver ->
// getDowntimeForWindow(maintenanceWindows) -> aggregateWindowedDowntime. The
// service stub's getDowntimeForWindow runs the actual interval math over a
// single fixed 60-minute closed outage ending at the window end (`now`), so the
// assertions reflect production behavior rather than a hand-mocked number.
//
// The budget window is TRAILING, so the regression these guard is: a COMPLETED
// maintenance overlapping the window is still subtracted (not just active ones),
// a CANCELLED one is not, and the consumed value does not jump as a window moves
// scheduled -> completed (monotonic).
// =============================================================================
describe("SloEngine maintenance-window exclusion", () => {
  const MINUTE = 60 * 1000;

  // A service whose getDowntimeForWindow honors the maintenanceWindows arg by
  // running the real aggregation over one 60-minute closed outage ending at the
  // window end. No open events, so the outage is counted from history.
  function createMaintenanceAwareService(): SloService {
    return {
      getOpenDowntimeEventsForObjective: mock(() => Promise.resolve([])),
      getDowntimeForWindow: mock(
        (args: {
          windowStart: Date;
          windowEnd: Date;
          maintenanceWindows?: Array<{ startAt: Date; endAt: Date }>;
        }) =>
          Promise.resolve(
            aggregateWindowedDowntime({
              events: [
                {
                  startTime: new Date(args.windowEnd.getTime() - 60 * MINUTE),
                  endTime: args.windowEnd,
                  attributionType: "self",
                  upstreamSystemId: null,
                  upstreamSystemName: null,
                },
              ],
              windowStart: args.windowStart,
              windowEnd: args.windowEnd,
              now: args.windowEnd,
              maintenanceWindows: args.maintenanceWindows,
            }),
          ),
      ),
    } as unknown as SloService;
  }

  function buildEngine() {
    const engine = new SloEngine({
      service: createMaintenanceAwareService(),
      signalService: createMockSignalService() as never,
      logger: createMockLogger() as never,
    });
    return engine;
  }

  // A maintenance window covering the FIRST 30 of the outage's 60 minutes,
  // reported with the given status. `to` is the budget window end (`now`).
  const halfCoveringWindow =
    (status: string) =>
    async ({ to }: { systemId: string; from: Date; to: Date }) => [
      {
        startAt: new Date(to.getTime() - 60 * MINUTE),
        endAt: new Date(to.getTime() - 30 * MINUTE),
        status,
      },
    ];

  it("counts the full outage when exclusion is OFF", async () => {
    const engine = buildEngine();
    engine.setMaintenanceWindowsResolver(halfCoveringWindow("completed"));
    const objective = createObjective({
      dependencyExclusion: "strict",
      excludeMaintenanceWindows: false,
    });
    const status = await engine.computeStatus({ objective });
    expect(status.errorBudgetConsumedMinutes).toBeCloseTo(60, 5);
  });

  it("subtracts a COMPLETED maintenance window overlapping the trailing budget window", async () => {
    const engine = buildEngine();
    engine.setMaintenanceWindowsResolver(halfCoveringWindow("completed"));
    const objective = createObjective({
      dependencyExclusion: "strict",
      excludeMaintenanceWindows: true,
    });
    const status = await engine.computeStatus({ objective });
    // 60 minutes of outage minus the 30 minutes under maintenance.
    expect(status.errorBudgetConsumedMinutes).toBeCloseTo(30, 5);
  });

  it("does NOT subtract a CANCELLED maintenance window", async () => {
    const engine = buildEngine();
    engine.setMaintenanceWindowsResolver(halfCoveringWindow("cancelled"));
    const objective = createObjective({
      dependencyExclusion: "strict",
      excludeMaintenanceWindows: true,
    });
    const status = await engine.computeStatus({ objective });
    expect(status.errorBudgetConsumedMinutes).toBeCloseTo(60, 5);
  });

  it("keeps consumed budget stable (monotonic) across scheduled -> completed", async () => {
    const objective = createObjective({
      dependencyExclusion: "strict",
      excludeMaintenanceWindows: true,
    });

    const scheduledEngine = buildEngine();
    scheduledEngine.setMaintenanceWindowsResolver(
      halfCoveringWindow("scheduled"),
    );
    const scheduled = await scheduledEngine.computeStatus({ objective });

    const completedEngine = buildEngine();
    completedEngine.setMaintenanceWindowsResolver(
      halfCoveringWindow("completed"),
    );
    const completed = await completedEngine.computeStatus({ objective });

    // The same window is subtracted regardless of its (non-cancelled) status,
    // so the number does not jump when the window transitions to completed.
    expect(completed.errorBudgetConsumedMinutes).toBeCloseTo(
      scheduled.errorBudgetConsumedMinutes,
      5,
    );
    expect(completed.errorBudgetConsumedMinutes).toBeCloseTo(30, 5);
  });
});
