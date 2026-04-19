import type { SatelliteAssignment } from "@checkstack/satellite-common";

interface SchedulerConfig {
  onExecute: (assignment: SatelliteAssignment) => Promise<void>;
  logger?: {
    info: (msg: string) => void;
    debug: (msg: string) => void;
  };
}

/**
 * Local scheduler for satellite health check execution.
 * Manages interval timers for each assignment. When assignments are updated,
 * existing timers are reconciled: unchanged assignments keep running,
 * removed assignments are stopped, and new assignments are started.
 */
export class Scheduler {
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  private readonly config: SchedulerConfig;

  constructor(config: SchedulerConfig) {
    this.config = config;
  }

  /**
   * Update the set of assignments. Reconciles timers with the new set.
   */
  updateAssignments(assignments: SatelliteAssignment[]): void {
    // Build a set of current assignment keys
    const newKeys = new Set(
      assignments.map((a) => this.makeKey(a)),
    );

    // Stop timers for removed assignments
    for (const [key, timer] of this.timers) {
      if (!newKeys.has(key)) {
        clearInterval(timer);
        this.timers.delete(key);
        this.config.logger?.debug(`Stopped scheduler for ${key}`);
      }
    }

    // Start timers for new/updated assignments
    for (const assignment of assignments) {
      const key = this.makeKey(assignment);
      if (this.timers.has(key)) {
        // Already running — keep existing timer
        continue;
      }

      this.config.logger?.debug(
        `Starting scheduler for ${key} (every ${assignment.intervalSeconds}s)`,
      );

      // Execute immediately, then at interval
      void this.config.onExecute(assignment);

      const timer = setInterval(
        () => void this.config.onExecute(assignment),
        assignment.intervalSeconds * 1000,
      );
      this.timers.set(key, timer);
    }

    this.config.logger?.info(
      `Scheduler updated: ${this.timers.size} active check(s)`,
    );
  }

  /** Stop all timers */
  stop(): void {
    for (const [key, timer] of this.timers) {
      clearInterval(timer);
      this.config.logger?.debug(`Stopped scheduler for ${key}`);
    }
    this.timers.clear();
  }

  /** Number of active timers */
  get activeCount(): number {
    return this.timers.size;
  }

  /** Unique key for an assignment (config+system, since a satellite only runs each once) */
  private makeKey(assignment: SatelliteAssignment): string {
    return `${assignment.configId}:${assignment.systemId}`;
  }
}
