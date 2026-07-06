import type {
  Dependency,
  DependencyWarning,
  DerivedState,
  ImpactType,
} from "@checkstack/dependency-common";

/** Per-health-check status within a slice (system rollup or one environment). */
export type SliceCheckStatus = {
  healthCheckId: string;
  status: "healthy" | "degraded" | "unhealthy";
};

/**
 * The health of one slice of a system: its rollup `status` plus optional
 * per-check breakdown. Used both for the system's cross-environment rollup and
 * for each individual environment.
 */
export interface SliceStatus {
  status: "operational" | "degraded" | "down";
  healthCheckStatuses?: SliceCheckStatus[];
}

/**
 * Upstream system status as reported by the platform.
 *
 * `status` / `healthCheckStatuses` are the CROSS-ENVIRONMENT rollup (what
 * every consumer saw before per-environment scoping). `environments` adds each
 * environment's own slice so a scope cell can read the exact `(check?, env?)`
 * slice it targets - crucially, the per-env slice is NOT the worst-wins rollup,
 * so a prod-only outage that the rollup hides is still visible here.
 */
export interface SystemStatus extends SliceStatus {
  systemId: string;
  systemName: string;
  /** Per-environment slices, keyed by environment id (real ids only). */
  environments?: Record<string, SliceStatus>;
}

/**
 * Evaluates derived dependency warnings based on system statuses.
 * This is a pure computation engine — it does not fetch data itself.
 */
export class WarningEvaluationService {
  /**
   * Evaluate dependency warnings for a set of systems.
   *
   * @param systemIds - The systems to evaluate
   * @param allDependencies - All dependency edges in the system
   * @param systemStatuses - Current status of all referenced systems
   * @returns Map of systemId → DependencyWarning (only for systems with warnings)
   */
  evaluateWarnings({
    systemIds,
    allDependencies,
    systemStatuses,
  }: {
    systemIds: string[];
    allDependencies: Dependency[];
    systemStatuses: Map<string, SystemStatus>;
  }): Map<string, DependencyWarning> {
    const warnings = new Map<string, DependencyWarning>();

    for (const systemId of systemIds) {
      const warning = this.evaluateSystem({
        systemId,
        allDependencies,
        systemStatuses,
        visited: new Set<string>(),
      });

      if (warning) {
        warnings.set(systemId, warning);
      }
    }

    return warnings;
  }

  /**
   * Evaluate a single system's dependency warning.
   */
  evaluateSystem({
    systemId,
    allDependencies,
    systemStatuses,
    visited,
  }: {
    systemId: string;
    allDependencies: Dependency[];
    systemStatuses: Map<string, SystemStatus>;
    visited: Set<string>;
  }): DependencyWarning | undefined {
    // Cycle guard: prevent infinite loops in transitive evaluation
    if (visited.has(systemId)) {
      return undefined;
    }
    visited.add(systemId);

    // Find all dependencies where this system is the source (downstream)
    const upstreamDeps = allDependencies.filter(
      (d) => d.sourceSystemId === systemId,
    );

    if (upstreamDeps.length === 0) {
      return undefined;
    }

    let worstDerivedState: DerivedState | undefined;
    const affectedUpstreams: DependencyWarning["affectedUpstreams"] = [];

    for (const dep of upstreamDeps) {
      const upstreamStatus = systemStatuses.get(dep.targetSystemId);
      if (!upstreamStatus) continue;

      // Determine the effective upstream status
      let effectiveStatus = upstreamStatus.status;

      // For transitive dependencies, consider the upstream's own derived warnings
      if (dep.transitive) {
        const upstreamWarning = this.evaluateSystem({
          systemId: dep.targetSystemId,
          allDependencies,
          systemStatuses,
          visited: new Set(visited), // Fresh copy to allow fan-out
        });

        if (upstreamWarning) {
          // Promote the effective status based on upstream's worst warning
          effectiveStatus = this.promoteStatus({
            ownStatus: effectiveStatus,
            warningState: upstreamWarning.derivedState,
          });
        }
      }

      // Evaluate impact based on the dependency configuration
      const derivedState = this.evaluateDependencyImpact({
        dependency: dep,
        upstreamStatus,
        effectiveOverallStatus: effectiveStatus,
      });

      if (derivedState) {
        affectedUpstreams.push({
          systemId: dep.targetSystemId,
          systemName: upstreamStatus.systemName,
          ownStatus: effectiveStatus,
          impactType: dep.impactType,
          dependencyLabel: dep.label,
        });

        worstDerivedState = this.worstState(worstDerivedState, derivedState);
      }
    }

    if (!worstDerivedState || affectedUpstreams.length === 0) {
      return undefined;
    }

    return {
      systemId,
      derivedState: worstDerivedState,
      affectedUpstreams,
    };
  }

  /**
   * Evaluate the impact of a single dependency.
   *
   * - With NO scope cells: watch the target's overall rollup at the edge's
   *   `impactType` (the default any-check/any-env behaviour). `effectiveOverall`
   *   already folds in any transitive promotion.
   * - With scope cells: watch ONLY those `(check?, env?)` slices, each at its
   *   own severity, worst-wins. The overall status is intentionally ignored so
   *   an env/check-specific outage the rollup hides can still fire.
   */
  private evaluateDependencyImpact({
    dependency,
    upstreamStatus,
    effectiveOverallStatus,
  }: {
    dependency: Dependency;
    upstreamStatus: SystemStatus;
    effectiveOverallStatus: "operational" | "degraded" | "down";
  }): DerivedState | undefined {
    const cells = dependency.healthCheckRules;
    if (cells && cells.length > 0) {
      return this.evaluateScopeCells({ cells, upstreamStatus });
    }

    // No cells: whole-system rollup at the edge severity.
    if (effectiveOverallStatus === "operational") {
      return undefined;
    }
    return this.applyImpactMatrix({
      impactType: dependency.impactType,
      upstreamStatus: effectiveOverallStatus,
    });
  }

  /**
   * Resolve each scope cell against the exact slice it targets and worst-wins
   * across them. A cell whose slice is healthy, missing (system not in that
   * environment / no runs), or otherwise operational simply does not
   * contribute - it never errors.
   */
  private evaluateScopeCells({
    cells,
    upstreamStatus,
  }: {
    cells: NonNullable<Dependency["healthCheckRules"]>;
    upstreamStatus: SystemStatus;
  }): DerivedState | undefined {
    let worstState: DerivedState | undefined;

    for (const cell of cells) {
      const sliceStatus = this.resolveCellStatus({ cell, upstreamStatus });
      if (sliceStatus === "operational") continue;

      const state = this.applyImpactMatrix({
        impactType: cell.overrideImpactType,
        upstreamStatus: sliceStatus,
      });
      worstState = this.worstState(worstState, state);
    }

    return worstState;
  }

  /**
   * Resolve the effective status of the slice a single cell targets.
   *
   * Cell shape → slice read:
   * - `(check=null, env=null)` → the system's cross-env rollup status.
   * - `(check=X,    env=null)` → check X in the cross-env per-check statuses.
   * - `(check=null, env=E)`    → environment E's own rollup status.
   * - `(check=X,    env=E)`    → check X within environment E's per-check statuses.
   *
   * A referenced environment/check with no data resolves to `operational`
   * (non-contributing), never an error.
   */
  private resolveCellStatus({
    cell,
    upstreamStatus,
  }: {
    cell: NonNullable<Dependency["healthCheckRules"]>[number];
    upstreamStatus: SystemStatus;
  }): "operational" | "degraded" | "down" {
    // Pick the slice: a specific environment, or the cross-env rollup.
    // NOTE: a `null` environmentId means ANY env (the rollup) here - it is NOT
    // the health-check domain's env-less slice. That translation is done when
    // building `SystemStatus.environments` (real env ids only).
    let slice: SliceStatus;
    if (cell.environmentId === null) {
      slice = upstreamStatus;
    } else {
      const env = upstreamStatus.environments?.[cell.environmentId];
      if (!env) return "operational"; // system not in env / no data
      slice = env;
    }

    // Any check in the slice → the slice's rollup status.
    if (cell.healthCheckId === null) {
      return slice.status;
    }

    // A specific check within the slice.
    const checkStatus = slice.healthCheckStatuses?.find(
      (s) => s.healthCheckId === cell.healthCheckId,
    );
    if (!checkStatus || checkStatus.status === "healthy") {
      return "operational";
    }
    return checkStatus.status === "unhealthy" ? "down" : "degraded";
  }

  /**
   * Apply the impact matrix to determine derived state.
   *
   * | Impact Type   | Upstream degraded  | Upstream down      |
   * |---------------|--------------------|--------------------|
   * | informational | info               | info               |
   * | degraded      | degraded           | degraded           |
   * | critical      | degraded           | down               |
   */
  private applyImpactMatrix({
    impactType,
    upstreamStatus,
  }: {
    impactType: ImpactType;
    upstreamStatus: "degraded" | "down";
  }): DerivedState {
    switch (impactType) {
      case "informational": {
        return "info";
      }
      case "degraded": {
        return "degraded";
      }
      case "critical": {
        return upstreamStatus === "down" ? "down" : "degraded";
      }
    }
  }

  /**
   * Promote a system's own status based on its upstream warning state.
   * Used for transitive evaluation.
   */
  private promoteStatus({
    ownStatus,
    warningState,
  }: {
    ownStatus: "operational" | "degraded" | "down";
    warningState: DerivedState;
  }): "operational" | "degraded" | "down" {
    const statusOrder: Record<string, number> = {
      operational: 0,
      info: 0, // info doesn't change the status
      degraded: 1,
      down: 2,
    };

    const ownLevel = statusOrder[ownStatus] ?? 0;
    const warningLevel = statusOrder[warningState] ?? 0;

    if (warningLevel > ownLevel) {
      return warningState === "down" ? "down" : "degraded";
    }
    return ownStatus;
  }

  /**
   * Return the worst of two derived states.
   */
  private worstState(
    a: DerivedState | undefined,
    b: DerivedState,
  ): DerivedState {
    if (!a) return b;

    const order: Record<DerivedState, number> = {
      info: 0,
      degraded: 1,
      down: 2,
    };

    return order[a] >= order[b] ? a : b;
  }
}
