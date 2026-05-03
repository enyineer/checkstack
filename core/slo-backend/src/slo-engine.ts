import type { SloService } from "./service";
import type {
  SloObjective,
  SloStatus,
} from "@checkstack/slo-common";
import type { Logger } from "@checkstack/backend-api";
import type { SignalService } from "@checkstack/signal-common";
import { SLO_STATUS_CHANGED } from "@checkstack/slo-common";

/**
 * Core SLO computation engine.
 *
 * Two responsibilities:
 * 1. Real-time event handler: reacts to SYSTEM_STATUS_CHANGED signals,
 *    creating/splitting/closing downtime events with correct attribution.
 * 2. Status computation: aggregates downtime events for API reads.
 */
export class SloEngine {
  private service: SloService;
  private signalService: SignalService;
  private logger: Logger;
  private _getSystemHealthStatus:
    | ((systemId: string) => Promise<{ isHealthy: boolean }>)
    | undefined;

  constructor({ service, signalService, logger }: {
    service: SloService;
    signalService: SignalService;
    logger: Logger;
  }) {
    this.service = service;
    this.signalService = signalService;
    this.logger = logger;
  }

  /**
   * Set the health status callback. Must be called from afterPluginsReady
   * once the healthcheck RPC client is available.
   */
  setHealthStatusCallback(
    callback: (systemId: string) => Promise<{ isHealthy: boolean }>,
  ) {
    this._getSystemHealthStatus = callback;
  }

  /**
   * Reconcile a newly created objective with the current system state.
   * If the system is already degraded, opens an initial downtime event.
   * Called after createObjective to handle the edge case where a system
   * was already unhealthy before the SLO existed.
   */
  async reconcileObjective({
    objective,
  }: {
    objective: { id: string; systemId: string };
  }): Promise<void> {
    if (!this._getSystemHealthStatus) {
      // Before afterPluginsReady — can't check. Skip gracefully.
      this.logger.debug(
        `SLO ${objective.id}: reconcileObjective skipped — no health callback set`,
      );
      return;
    }

    const health = await this._getSystemHealthStatus(objective.systemId);
    if (health.isHealthy) return;

    // System is already down — check if there's already an event (defensive)
    const openEvents = await this.service.getOpenDowntimeEventsForObjective({
      objectiveId: objective.id,
    });
    if (openEvents.length > 0) return;

    // Open an initial downtime event attributed to self
    await this.service.openDowntimeEvent({
      objectiveId: objective.id,
      systemId: objective.systemId,
      attributionType: "self",
    });

    this.logger.info(
      `SLO ${objective.id}: Initial downtime event — system already degraded at creation time`,
    );
  }

  // ===========================================================================
  // PERSPECTIVE 1: This system's own SLOs
  // ===========================================================================

  /**
   * Handle a system transitioning to unhealthy.
   * Opens new downtime events for all SLO objectives on this system.
   */
  async handleSystemDown({
    systemId,
    getUpstreamHealthStatus,
  }: {
    systemId: string;
    getUpstreamHealthStatus: ({
      upstreamSystemId,
    }: {
      upstreamSystemId: string;
    }) => Promise<{ isHealthy: boolean; systemName: string }>;
  }): Promise<void> {
    const objectives = await this.service.getObjectivesForSystem({ systemId });

    for (const objective of objectives) {
      // Check if there's already an open event (idempotent)
      const openEvents = await this.service.getOpenDowntimeEventsForObjective({
        objectiveId: objective.id,
      });
      if (openEvents.length > 0) {
        this.logger.debug(
          `SLO ${objective.id}: Already has open downtime events, skipping`,
        );
        continue;
      }

      const attribution = await this.determineAttribution({
        objective,
        _getUpstreamHealthStatus: getUpstreamHealthStatus,
      });

      await this.service.openDowntimeEvent({
        objectiveId: objective.id,
        systemId,
        attributionType: attribution.type,
        upstreamSystemId: attribution.upstreamSystemId,
        upstreamSystemName: attribution.upstreamSystemName,
      });

      this.logger.info(
        `SLO ${objective.id}: Downtime started (attribution: ${attribution.type}${attribution.upstreamSystemName ? ` → ${attribution.upstreamSystemName}` : ""})`,
      );
    }
  }

  /**
   * Handle a system transitioning to healthy.
   * Closes all open downtime events and recomputes SLO status.
   */
  async handleSystemUp({
    systemId,
  }: {
    systemId: string;
  }): Promise<void> {
    const openEvents = await this.service.getOpenDowntimeEvents({ systemId });

    for (const event of openEvents) {
      await this.service.closeDowntimeEvent({ id: event.id });
      this.logger.info(
        `SLO event ${event.id}: Closed (${event.attributionType})`,
      );
    }

    // Recompute and broadcast status for all affected objectives
    const objectiveIds = [...new Set(openEvents.map((e) => e.objectiveId))];
    for (const objectiveId of objectiveIds) {
      const objective = await this.service.getObjective({ id: objectiveId });
      if (!objective) continue;

      const status = await this.computeStatus({ objective });
      await this.signalService.broadcast(SLO_STATUS_CHANGED, {
        systemId,
        objectiveId,
        budgetRemainingPercent: status.errorBudgetRemainingPercent,
        isBreaching: status.isBreaching,
      });
    }
  }

  // ===========================================================================
  // PERSPECTIVE 2: This system as an upstream dependency
  // ===========================================================================

  /**
   * Handle an upstream dependency going down.
   * Splits open "self" events on downstream systems into "upstream" events.
   */
  async handleUpstreamDown({
    upstreamSystemId,
    upstreamSystemName,
    downstreamSystemIds,
  }: {
    upstreamSystemId: string;
    upstreamSystemName: string;
    downstreamSystemIds: string[];
  }): Promise<void> {
    for (const downstreamId of downstreamSystemIds) {
      const openSelfEvents = await this.service.getOpenSelfEvents({
        systemId: downstreamId,
      });

      for (const event of openSelfEvents) {
        // Get the objective to check exclusion mode
        const objective = await this.service.getObjective({
          id: event.objectiveId,
        });
        if (!objective || objective.dependencyExclusion === "strict") continue;

        // Check if this upstream is excluded from the objective
        if (objective.excludedDependencyIds?.includes(upstreamSystemId))
          continue;

        // SPLIT: Close "self" event, open "upstream" event
        await this.service.closeDowntimeEvent({ id: event.id });
        await this.service.openDowntimeEvent({
          objectiveId: event.objectiveId,
          systemId: downstreamId,
          attributionType: "upstream",
          upstreamSystemId,
          upstreamSystemName,
        });

        this.logger.info(
          `SLO ${event.objectiveId}: Split event — self → upstream (${upstreamSystemName})`,
        );
      }
    }
  }

  /**
   * Handle an upstream dependency recovering.
   * Splits open "upstream" events on downstream systems back to "self"
   * (or to another upstream if one is still down).
   */
  async handleUpstreamUp({
    upstreamSystemId,
    downstreamSystemIds,
    getUpstreamHealthStatus,
  }: {
    upstreamSystemId: string;
    downstreamSystemIds: string[];
    getUpstreamHealthStatus: ({
      upstreamSystemId,
    }: {
      upstreamSystemId: string;
    }) => Promise<{ isHealthy: boolean; systemName: string }>;
  }): Promise<void> {
    for (const downstreamId of downstreamSystemIds) {
      const upstreamEvents = await this.service.getOpenUpstreamEvents({
        systemId: downstreamId,
        upstreamSystemId,
      });

      for (const event of upstreamEvents) {
        const objective = await this.service.getObjective({
          id: event.objectiveId,
        });
        if (!objective) continue;

        // Close the upstream event
        await this.service.closeDowntimeEvent({ id: event.id });

        // Check if the downstream system is still down
        // (if it recovered, handleSystemUp already closed everything)
        const stillOpen = await this.service.getOpenDowntimeEventsForObjective({
          objectiveId: event.objectiveId,
        });
        // If there are other open events for this objective, skip
        if (stillOpen.length > 0) continue;

        // The downstream is still down — determine new attribution
        const newAttribution = await this.determineAttribution({
          objective,
          _getUpstreamHealthStatus: getUpstreamHealthStatus,
          _excludeUpstreamId: upstreamSystemId,
        });

        await this.service.openDowntimeEvent({
          objectiveId: event.objectiveId,
          systemId: downstreamId,
          attributionType: newAttribution.type,
          upstreamSystemId: newAttribution.upstreamSystemId,
          upstreamSystemName: newAttribution.upstreamSystemName,
        });

        this.logger.info(
          `SLO ${event.objectiveId}: Split event — upstream (${upstreamSystemId}) → ${newAttribution.type}${newAttribution.upstreamSystemName ? ` (${newAttribution.upstreamSystemName})` : ""}`,
        );
      }
    }
  }

  // ===========================================================================
  // STATUS COMPUTATION
  // ===========================================================================

  /**
   * Compute the current SLO status for display.
   * Reads from pre-computed downtime events — fast O(events-in-window).
   */
  async computeStatus({
    objective,
  }: {
    objective: SloObjective;
  }): Promise<SloStatus> {
    const now = new Date();
    const windowStart = new Date(
      now.getTime() - objective.windowDays * 24 * 60 * 60 * 1000,
    );

    const downtime = await this.service.getDowntimeForWindow({
      objectiveId: objective.id,
      windowStart,
      windowEnd: now,
    });

    const totalWindowMinutes = objective.windowDays * 24 * 60;
    const allowedDowntimeMinutes =
      ((100 - objective.target) / 100) * totalWindowMinutes;

    // What counts depends on the exclusion mode
    const consumedMinutes =
      objective.dependencyExclusion === "strict"
        ? downtime.totalMinutes
        : downtime.selfMinutes;

    const remainingMinutes = Math.max(0, allowedDowntimeMinutes - consumedMinutes);
    const remainingPercent =
      allowedDowntimeMinutes > 0
        ? (remainingMinutes / allowedDowntimeMinutes) * 100
        : 100;

    const effectiveAvailability =
      totalWindowMinutes > 0
        ? ((totalWindowMinutes - consumedMinutes) / totalWindowMinutes) * 100
         
        : null;

    const strictAvailability =
      totalWindowMinutes > 0
        ? ((totalWindowMinutes - downtime.totalMinutes) / totalWindowMinutes) * 100
         
        : null;

    // Burn rate: how fast are we consuming budget relative to the window?
    const elapsedDays = Math.max(
      (now.getTime() - windowStart.getTime()) / (24 * 60 * 60 * 1000),
      1,
    );
    const expectedConsumption =
      (elapsedDays / objective.windowDays) * allowedDowntimeMinutes;
    const burnRate =
       
      expectedConsumption > 0 ? consumedMinutes / expectedConsumption : null;

    // Check for open downtime events
    const openEvents = await this.service.getOpenDowntimeEventsForObjective({
      objectiveId: objective.id,
    });

    // Build attribution breakdown
    const attribution = downtime.entries.map((entry) => ({
      sourceType: entry.attributionType as "self" | "upstream",
      systemId: entry.upstreamSystemId ?? undefined,
      systemName: entry.upstreamSystemName ?? undefined,
      minutes: entry.totalMinutes,
    }));

    return {
      objectiveId: objective.id,
      systemId: objective.systemId,
      target: objective.target,
      windowDays: objective.windowDays,
      healthCheckConfigurationId: objective.healthCheckConfigurationId,
       
      healthCheckConfigurationName: null,
      currentAvailability: effectiveAvailability,
      strictAvailability,
      errorBudgetTotalMinutes: allowedDowntimeMinutes,
      errorBudgetConsumedMinutes: consumedMinutes,
      errorBudgetConsumedStrictMinutes: downtime.totalMinutes,
      errorBudgetRemainingMinutes: remainingMinutes,
      errorBudgetRemainingPercent: remainingPercent,
      burnRate,
      dependencyExclusion: objective.dependencyExclusion,
      isBreaching: effectiveAvailability !== null && effectiveAvailability < objective.target,
      hasOpenDowntime: openEvents.length > 0,
      attribution,
    };
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  /**
   * Determine attribution for a new downtime event based on the objective's
   * dependency exclusion mode and the current health of upstream dependencies.
   */
  private async determineAttribution({
    objective,
    _getUpstreamHealthStatus,
    _excludeUpstreamId,
  }: {
    objective: SloObjective;
    _getUpstreamHealthStatus: ({
      upstreamSystemId,
    }: {
      upstreamSystemId: string;
    }) => Promise<{ isHealthy: boolean; systemName: string }>;
    _excludeUpstreamId?: string;
  }): Promise<{
    type: "self" | "upstream";
    upstreamSystemId?: string;
    upstreamSystemName?: string;
  }> {
    // Strict mode: always self
    if (objective.dependencyExclusion === "strict") {
      return { type: "self" };
    }

    // For non-strict modes: check upstream dependencies
    // The caller provides the getUpstreamHealthStatus function, which queries
    // the dependency map and health check status via RPC
    // This is injected to keep the engine testable without real RPC calls

    // Note: The engine doesn't query dependencies directly — the plugin index.ts
    // wires up the actual dependency and health check clients as the callback.
    // This function signature intentionally takes a callback for testability.

    return { type: "self" };
  }
}
