import type {
  Dependency,
  DependencyWarning,
  DerivedState,
  ImpactType,
} from "@checkstack/dependency-common";

/**
 * Upstream system status as reported by the platform.
 */
export interface SystemStatus {
  systemId: string;
  systemName: string;
  /** Overall system status: operational, degraded, or down */
  status: "operational" | "degraded" | "down";
  /** Per-health-check statuses (for advanced rules) */
  healthCheckStatuses?: Array<{
    healthCheckId: string;
    status: "healthy" | "degraded" | "unhealthy";
  }>;
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
        upstreamStatus: effectiveStatus,
        upstreamHealthChecks: upstreamStatus.healthCheckStatuses,
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
   * Evaluate the impact of a single dependency based on upstream status.
   * Returns the derived state, or undefined if no impact.
   */
  private evaluateDependencyImpact({
    dependency,
    upstreamStatus,
    upstreamHealthChecks,
  }: {
    dependency: Dependency;
    upstreamStatus: "operational" | "degraded" | "down";
    upstreamHealthChecks?: Array<{
      healthCheckId: string;
      status: "healthy" | "degraded" | "unhealthy";
    }>;
  }): DerivedState | undefined {
    // If upstream is operational, no impact
    if (upstreamStatus === "operational") {
      return undefined;
    }

    // If the dependency has health check rules, evaluate those instead
    if (
      dependency.healthCheckRules &&
      dependency.healthCheckRules.length > 0 &&
      upstreamHealthChecks
    ) {
      return this.evaluateHealthCheckRules({
        rules: dependency.healthCheckRules,
        healthCheckStatuses: upstreamHealthChecks,
      });
    }

    // Apply the impact matrix based on overall status
    return this.applyImpactMatrix({
      impactType: dependency.impactType,
      upstreamStatus,
    });
  }

  /**
   * Evaluate health check rules for a dependency.
   * Returns the worst derived state from matching rules, or undefined.
   */
  private evaluateHealthCheckRules({
    rules,
    healthCheckStatuses,
  }: {
    rules: NonNullable<Dependency["healthCheckRules"]>;
    healthCheckStatuses: Array<{
      healthCheckId: string;
      status: "healthy" | "degraded" | "unhealthy";
    }>;
  }): DerivedState | undefined {
    let worstState: DerivedState | undefined;

    for (const rule of rules) {
      const checkStatus = healthCheckStatuses.find(
        (s) => s.healthCheckId === rule.healthCheckId,
      );

      // If the check is not found or is healthy, skip
      if (!checkStatus || checkStatus.status === "healthy") continue;

      // Map health check status to upstream status equivalent
      const upstreamEquivalent =
        checkStatus.status === "unhealthy" ? "down" : "degraded";

      const state = this.applyImpactMatrix({
        impactType: rule.overrideImpactType,
        upstreamStatus: upstreamEquivalent,
      });

      if (state) {
        worstState = this.worstState(worstState, state);
      }
    }

    return worstState;
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
