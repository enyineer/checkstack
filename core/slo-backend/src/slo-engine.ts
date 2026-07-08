import type { SloService } from "./service";
import type {
  SloObjective,
  SloStatus,
  SloDowntimeEvent,
  AttributionType,
  DowntimeSource,
} from "@checkstack/slo-common";
import type { AdvisoryLockService, Logger } from "@checkstack/backend-api";
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
  private advisoryLock: AdvisoryLockService | undefined;
  private _getSystemHealthStatus:
    | ((systemId: string) => Promise<{ isHealthy: boolean }>)
    | undefined;
  private _getRecoveryTimeAfter:
    | ((args: {
        systemId: string;
        since: Date;
      }) => Promise<Date | null>)
    | undefined;
  private _getMaintenanceWindows:
    | ((args: {
        systemId: string;
        from: Date;
        to: Date;
      }) => Promise<Array<{ startAt: Date; endAt: Date; status: string }>>)
    | undefined;
  private _isIncidentOverrideActive:
    | ((args: { systemId: string }) => Promise<{ active: boolean }>)
    | undefined;

  constructor({ service, signalService, logger, advisoryLock }: {
    service: SloService;
    signalService: SignalService;
    logger: Logger;
    /**
     * Cross-pod advisory lock used to serialize the "open a downtime event if
     * none is open" critical section across the INDEPENDENT work-queue consumers
     * that can each open one (health-check `handleSystemDown`, the incident
     * channel `reconcileIncidentDowntime`, and `reconcileObjective`). Without it,
     * two near-simultaneous jobs (e.g. a health-check failure and the
     * auto-incident it triggers, possibly on different pods) both read zero open
     * events and both INSERT, producing two overlapping open events that
     * `getDowntimeForWindow` double-counts. Optional: unit tests run without it
     * (single process, no race), and the underlying write still succeeds.
     */
    advisoryLock?: AdvisoryLockService;
  }) {
    this.service = service;
    this.signalService = signalService;
    this.logger = logger;
    this.advisoryLock = advisoryLock;
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
   * Set the recovery-time resolver: given a system and a start instant, return
   * the timestamp the system FIRST became healthy on/after `since` (the actual
   * recovery time), or null if it can't be determined (no healthy point found /
   * history pruned). Used to CLOSE a missed-recovery orphan at its true recovery
   * time instead of deleting it (which would erase genuine downtime). Wired in
   * afterPluginsReady from the healthcheck run history.
   */
  setRecoveryTimeResolver(
    resolver: (args: { systemId: string; since: Date }) => Promise<Date | null>,
  ) {
    this._getRecoveryTimeAfter = resolver;
  }

  /**
   * Set the maintenance-windows resolver: given a system id and the budget
   * window `[from, to]`, return the maintenance windows OVERLAPPING that range
   * (with status). Used to subtract maintenance overlap from the error budget
   * when an objective has `excludeMaintenanceWindows`. The budget window is
   * TRAILING, so the resolver MUST include already-completed windows (the data
   * source does, filtering out only `cancelled`); the engine additionally drops
   * any `cancelled` window defensively before subtraction. Wired in
   * afterPluginsReady from the maintenance RPC client.
   */
  setMaintenanceWindowsResolver(
    resolver: (args: {
      systemId: string;
      from: Date;
      to: Date;
    }) => Promise<Array<{ startAt: Date; endAt: Date; status: string }>>,
  ) {
    this._getMaintenanceWindows = resolver;
  }

  /**
   * Set the incident-override resolver: given a system id, report whether an
   * incident currently forces a health override onto it (via
   * `IncidentApi.getActiveHealthOverrides`). Used ONLY to LABEL a new downtime
   * event's `source` when the cause cannot be inferred from the trigger edge
   * (the incident channel and objective-reconcile paths). The open/close
   * DECISIONS are driven by EFFECTIVE health (`_getSystemHealthStatus`, which
   * already folds overrides), not by this resolver. Wired in afterPluginsReady
   * from the incident RPC client.
   */
  setIncidentOverrideResolver(
    resolver: (args: { systemId: string }) => Promise<{ active: boolean }>,
  ) {
    this._isIncidentOverrideActive = resolver;
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

    // Open an initial downtime event attributed to self. The system is
    // effectively down (checks and/or an incident override); label the cause so
    // an incident-forced event is not later mishandled by the orphan self-heal.
    // Source is resolved OUTSIDE the lock (it may RPC); the insert is serialized.
    const source = await this.resolveDowntimeSource({
      systemId: objective.systemId,
    });
    const opened = await this.openDowntimeEventIfNone({
      objectiveId: objective.id,
      systemId: objective.systemId,
      attributionType: "self",
      source,
    });

    if (opened) {
      this.logger.info(
        `SLO ${objective.id}: Initial downtime event (source=${source}) — system already degraded at creation time`,
      );
    }
  }

  /**
   * Reconcile missed-recovery orphans: open downtime events on a system that is
   * currently healthy. The edge-triggered close (on the health recovery
   * transition) records real downtime accurately; this is the safety net for
   * when that transition was never delivered (restart, dropped change, or the
   * offending check being fixed/paused/deleted - none of which emit a health
   * edge), which would otherwise leave an event open forever.
   *
   * The downtime was REAL, so we must not erase it. We resolve the system's
   * ACTUAL recovery time from health-check run history (the first healthy point
   * on/after the event started) and CLOSE the event at that timestamp, so the
   * genuine downtime is recorded against the budget. We only DELETE as a
   * fallback when the recovery time can't be determined (no resolver wired, or
   * history pruned) - an unprovable downtime must not be counted.
   *
   * Safe to call from any WRITE-capable context — the daily job, objective
   * mutations, and the user-facing RPC read HANDLERS (so the dashboard self-
   * heals a missed recovery the moment it is viewed). It must NOT be called from
   * the reactive entity `read` accessor / `computeStatus`, which feeds the wake
   * index and must stay side-effect-free. Idempotent and a cheap no-op when the
   * objective has no open events (one indexed lookup, no write).
   */
  async reconcileOrphanedDowntime({
    objective,
  }: {
    objective: { id: string; systemId: string };
  }): Promise<void> {
    const openEvents = await this.service.getOpenDowntimeEventsForObjective({
      objectiveId: objective.id,
    });
    if (openEvents.length === 0) return;
    if (!this._getSystemHealthStatus) return;

    const health = await this._getSystemHealthStatus(objective.systemId);
    if (!health.isHealthy) return; // genuinely down — the open event is real

    for (const event of openEvents) {
      // Incident-sourced events are owned by the incident channel, which closes
      // them on incident resolve/delete/override-clear. They must NOT be closed
      // from health-check run history: an incident forces downtime while the
      // probes stay HEALTHY, so the "first healthy run" resolver would close at
      // ~the start instant and erase the real incident downtime. Skip them.
      if (event.source === "incident") continue;

      // Find when the system ACTUALLY became healthy again, on/after this
      // event started. Closing at that instant preserves the genuine downtime;
      // deleting (the fallback) would erase it and read a false 100%.
      const recoveryTime = this._getRecoveryTimeAfter
        ? await this._getRecoveryTimeAfter({
            systemId: objective.systemId,
            since: event.startTime,
          })
        : null;

      if (recoveryTime) {
        await this.service.closeDowntimeEvent({
          id: event.id,
          endTime: recoveryTime,
        });
        this.logger.info(
          `SLO ${objective.id}: closed orphaned downtime event ${event.id} at its actual recovery time ${recoveryTime.toISOString()} — recovery transition was missed`,
        );
      } else {
        await this.service.deleteDowntimeEvent({ id: event.id });
        this.logger.info(
          `SLO ${objective.id}: voided orphaned downtime event ${event.id} — system is healthy but the recovery time could not be determined`,
        );
      }
    }
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
      // Cheap unlocked pre-check: skip the attribution work when an event is
      // already open. The AUTHORITATIVE idempotency guard is the locked re-check
      // inside openDowntimeEventIfNone (a concurrent opener may commit between
      // this read and the insert).
      const openEvents = await this.service.getOpenDowntimeEventsForObjective({
        objectiveId: objective.id,
      });
      if (openEvents.length > 0) {
        this.logger.debug(
          `SLO ${objective.id}: Already has open downtime events, skipping`,
        );
        continue;
      }

      // Compute attribution OUTSIDE the lock: it may issue RPCs, which must
      // never run inside the advisory-lock transaction.
      const attribution = await this.determineAttribution({
        objective,
        _getUpstreamHealthStatus: getUpstreamHealthStatus,
      });

      const opened = await this.openDowntimeEventIfNone({
        objectiveId: objective.id,
        systemId,
        attributionType: attribution.type,
        upstreamSystemId: attribution.upstreamSystemId,
        upstreamSystemName: attribution.upstreamSystemName,
        source: "healthcheck",
      });

      if (opened) {
        this.logger.info(
          `SLO ${objective.id}: Downtime started (attribution: ${attribution.type}${attribution.upstreamSystemName ? ` → ${attribution.upstreamSystemName}` : ""})`,
        );
      }
    }
  }

  /**
   * Handle a system whose HEALTH CHECKS recovered.
   *
   * Checks recovering does NOT necessarily mean the system is available: an
   * active incident override may still force it unhealthy/degraded. Closing the
   * open events here would erase that still-ongoing incident downtime, so this
   * only closes when the system is EFFECTIVELY healthy (checks AND incidents
   * clear). The incident channel (`reconcileIncidentDowntime`) performs the
   * mirror close when the incident later clears while checks are already healthy.
   */
  async handleSystemUp({
    systemId,
  }: {
    systemId: string;
  }): Promise<void> {
    await this.closeOpenEventsIfEffectivelyHealthy({ systemId });
  }

  /**
   * Reconcile a system's downtime after an incident lifecycle change (create,
   * update — including a health override added / changed / cleared —, resolve,
   * or delete). Idempotent and driven by EFFECTIVE health (which folds active
   * incident overrides):
   *
   * - effectively healthy (incident cleared/resolved/deleted AND checks healthy)
   *   → close all open events (the mirror of the health-recovery close), and
   * - effectively down → ensure ONE open event exists per objective, opening an
   *   incident-sourced event only when none is open. A concurrent health-check
   *   outage already owns the event, so this can never double-count.
   */
  async reconcileIncidentDowntime({
    systemId,
  }: {
    systemId: string;
  }): Promise<void> {
    if (!this._getSystemHealthStatus) {
      this.logger.debug(
        `SLO: reconcileIncidentDowntime(${systemId}) skipped — no health callback set`,
      );
      return;
    }

    const health = await this._getSystemHealthStatus(systemId);
    if (health.isHealthy) {
      // Incident cleared/resolved/deleted AND checks healthy → close. Events
      // close at `now`. For an incident-sourced event this IS the true recovery
      // (the override lifted at ~this instant). A rare stale healthcheck-sourced
      // orphan would also close at `now` rather than its true recovery time, but
      // that is conservative (never under-counts) and matches handleSystemUp's
      // recovery-edge close; the accurate-recovery-time path lives in
      // reconcileOrphanedDowntime (SLO-3).
      await this.closeOpenEventsAndBroadcast({ systemId });
      return;
    }

    // Effectively down. Open one incident-sourced event per objective that has
    // none open. If checks are the real cause, handleSystemDown already opened a
    // healthcheck-sourced event, so this is a no-op for that objective.
    const objectives = await this.service.getObjectivesForSystem({ systemId });
    for (const objective of objectives) {
      // Cheap unlocked pre-check; the locked re-check inside
      // openDowntimeEventIfNone is the authoritative guard against a concurrent
      // health-check `handleSystemDown` opening the same objective's event.
      const openEvents = await this.service.getOpenDowntimeEventsForObjective({
        objectiveId: objective.id,
      });
      if (openEvents.length > 0) continue;

      // Resolve the cause label OUTSIDE the lock (it issues an RPC).
      const source = await this.resolveDowntimeSource({ systemId });
      const opened = await this.openDowntimeEventIfNone({
        objectiveId: objective.id,
        systemId,
        attributionType: "self",
        source,
      });
      if (!opened) continue;

      this.logger.info(
        `SLO ${objective.id}: incident-forced downtime started (source=${source})`,
      );

      const status = await this.computeStatus({ objective });
      await this.signalService.broadcast(SLO_STATUS_CHANGED, {
        systemId,
        objectiveId: objective.id,
        budgetRemainingPercent: status.errorBudgetRemainingPercent,
        isBreaching: status.isBreaching,
      });
    }
  }

  /**
   * Close all open downtime events for a system ONLY when it is EFFECTIVELY
   * healthy (checks AND incidents clear — `_getSystemHealthStatus` folds active
   * overrides). No-op while still effectively down, so a recovery edge on one
   * cause cannot close downtime the other cause is still holding open. When no
   * health callback is wired (tests / before afterPluginsReady) it falls back to
   * closing unconditionally, preserving the legacy recovery-edge behavior.
   */
  private async closeOpenEventsIfEffectivelyHealthy({
    systemId,
  }: {
    systemId: string;
  }): Promise<void> {
    if (this._getSystemHealthStatus) {
      const health = await this._getSystemHealthStatus(systemId);
      if (!health.isHealthy) {
        this.logger.debug(
          `SLO: system ${systemId} still effectively down (checks or incident) — keeping open downtime events`,
        );
        return;
      }
    }
    await this.closeOpenEventsAndBroadcast({ systemId });
  }

  /**
   * Close every open downtime event for a system, then recompute + broadcast
   * `SLO_STATUS_CHANGED` for each affected objective. Source-agnostic: it closes
   * healthcheck- and incident-sourced events alike (the CALLER decides that the
   * system is healthy). No-op when there are no open events.
   */
  private async closeOpenEventsAndBroadcast({
    systemId,
  }: {
    systemId: string;
  }): Promise<void> {
    const openEvents = await this.service.getOpenDowntimeEvents({ systemId });

    for (const event of openEvents) {
      await this.service.closeDowntimeEvent({ id: event.id });
      this.logger.info(
        `SLO event ${event.id}: Closed (${event.attributionType}, source=${event.source ?? "healthcheck"})`,
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

  /**
   * Label a new downtime event's cause when it is ambiguous (the incident
   * channel and objective-reconcile paths). The health-check down/creation edges
   * know their probes are failing and pass "healthcheck" directly. Returns
   * "incident" when an incident override is active — the safe default, because an
   * incident-labeled event is skipped by the orphan self-heal and both channels
   * still close it via effective health — otherwise "healthcheck".
   */
  /**
   * Open a downtime event for an objective IFF none is currently open,
   * serialized across pods by a per-objective advisory lock so two independent
   * work-queue consumers (health-check down + incident channel) can never both
   * observe "no open event" and both INSERT a duplicate overlapping event.
   *
   * The re-check + insert run INSIDE the lock: `pg_advisory_xact_lock` blocks
   * every other holder of this key until this lock transaction commits, so a
   * racing opener waits at acquire and its re-check cannot observe "none open"
   * until our insert has committed. Only DB work runs inside the lock (the
   * caller resolves attribution/source, which may RPC, BEFORE calling this) so
   * no non-DB await is wrapped in the lock transaction. Returns the opened event,
   * or undefined when one was already open (idempotent no-op). Falls back to an
   * unlocked check+insert when no advisory lock is wired (unit tests).
   */
  private async openDowntimeEventIfNone({
    objectiveId,
    systemId,
    attributionType,
    upstreamSystemId,
    upstreamSystemName,
    source,
  }: {
    objectiveId: string;
    systemId: string;
    attributionType: AttributionType;
    upstreamSystemId?: string;
    upstreamSystemName?: string;
    source?: DowntimeSource;
  }): Promise<SloDowntimeEvent | undefined> {
    const checkThenInsert = async (): Promise<SloDowntimeEvent | undefined> => {
      const openEvents = await this.service.getOpenDowntimeEventsForObjective({
        objectiveId,
      });
      if (openEvents.length > 0) return undefined;
      return this.service.openDowntimeEvent({
        objectiveId,
        systemId,
        attributionType,
        upstreamSystemId,
        upstreamSystemName,
        source,
      });
    };

    if (!this.advisoryLock) return checkThenInsert();
    return this.advisoryLock.withXactLock({
      key: `slo.downtime-open:${objectiveId}`,
      fn: checkThenInsert,
    });
  }

  private async resolveDowntimeSource({
    systemId,
  }: {
    systemId: string;
  }): Promise<DowntimeSource> {
    if (this._isIncidentOverrideActive) {
      try {
        const { active } = await this._isIncidentOverrideActive({ systemId });
        if (active) return "incident";
      } catch {
        // Best-effort label, not a decision — fall back to "healthcheck".
      }
    }
    return "healthcheck";
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

    // LIVE HEALTH IS AUTHORITATIVE for "currently down". A stored open downtime
    // event is only real ongoing downtime if the system is actually down right
    // now - never trusted on its own. This makes the SLO numbers immune to a
    // drifted/orphaned event log: a healthy system can never read breaching or
    // degraded from a stale open row, by construction. The health check is
    // gated on there being open events at all, so the common (no-open-event)
    // path does no extra work. This method stays side-effect-free (the reactive
    // `slo` entity reads through it); orphan rows are voided by the daily job.
    const openEvents = await this.service.getOpenDowntimeEventsForObjective({
      objectiveId: objective.id,
    });
    let currentlyDown: boolean;
    if (openEvents.length === 0) {
      currentlyDown = false;
    } else if (this._getSystemHealthStatus) {
      const health = await this._getSystemHealthStatus(objective.systemId);
      currentlyDown = !health.isHealthy;
    } else {
      // Before afterPluginsReady wires the health callback, fall back to
      // trusting the stored open state (best effort).
      currentlyDown = true;
    }

    // Planned maintenance exclusion (opt-in per objective). Subtract the
    // portion of any downtime that overlaps a non-cancelled maintenance window
    // on the system. The resolver is wired in afterPluginsReady; when it is
    // absent (e.g. before ready) exclusion is simply skipped.
    let maintenanceWindows:
      | Array<{ startAt: Date; endAt: Date }>
      | undefined;
    if (objective.excludeMaintenanceWindows && this._getMaintenanceWindows) {
      const windows = await this._getMaintenanceWindows({
        systemId: objective.systemId,
        from: windowStart,
        to: now,
      });
      maintenanceWindows = windows
        .filter((w) => w.status !== "cancelled")
        .map((w) => ({ startAt: w.startAt, endAt: w.endAt }));
    }

    const downtime = await this.service.getDowntimeForWindow({
      objectiveId: objective.id,
      windowStart,
      windowEnd: now,
      includeOpen: currentlyDown,
      maintenanceWindows,
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

    // "Degraded" (open downtime) requires BOTH that the system is currently
    // down AND that an open event counts toward this objective's budget. In
    // self-only mode an open upstream outage is excluded; and a stale open event
    // on a now-healthy system (currentlyDown === false) never counts - so the
    // SLO can never read available-and-degraded at once.
    const budgetRelevantOpenEvents = currentlyDown
      ? objective.dependencyExclusion === "strict"
        ? openEvents
        : openEvents.filter((event) => event.attributionType === "self")
      : [];

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
      hasOpenDowntime: budgetRelevantOpenEvents.length > 0,
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
