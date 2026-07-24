import type {
  SatelliteAssignment,
  SatelliteEnvironment,
} from "@checkstack/satellite-common";

/**
 * One scheduled unit of work: an assignment paired with the ONE environment
 * this timer runs it for, or `null` for an env-less run.
 *
 * The core resolves which environments this satellite is responsible for
 * (narrowing the assignment's set by the satellite's own scoping), so the
 * agent simply runs whatever it is handed - it never decides scope itself.
 */
export interface ScheduledRun {
  assignment: SatelliteAssignment;
  environment: SatelliteEnvironment | null;
}

interface SchedulerConfig {
  onExecute: (run: ScheduledRun) => Promise<void>;
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
    // One timer per (assignment, environment): a check assigned to three
    // environments runs three times per interval, each reporting its own
    // environment, exactly as the core's local executor fans out.
    const runs = expandRuns(assignments);
    const newKeys = new Set(runs.map((r) => this.makeKey(r)));

    // Stop timers for removed assignments
    for (const [key, timer] of this.timers) {
      if (!newKeys.has(key)) {
        clearInterval(timer);
        this.timers.delete(key);
        this.config.logger?.debug(`Stopped scheduler for ${key}`);
      }
    }

    // Start timers for new/updated runs
    for (const run of runs) {
      const key = this.makeKey(run);
      if (this.timers.has(key)) {
        // Already running — keep existing timer
        continue;
      }

      this.config.logger?.debug(
        `Starting scheduler for ${key} (every ${run.assignment.intervalSeconds}s)`,
      );

      // Execute immediately, then at interval
      void this.config.onExecute(run);

      const timer = setInterval(
        () => void this.config.onExecute(run),
        run.assignment.intervalSeconds * 1000,
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

  /**
   * Unique key per scheduled run. The environment is part of it, so adding or
   * removing an environment starts/stops exactly that one timer and leaves the
   * others running.
   */
  private makeKey({ assignment, environment }: ScheduledRun): string {
    return `${assignment.configId}:${assignment.systemId}:${environment?.id ?? "<none>"}`;
  }
}

/**
 * Expand assignments into one run per environment.
 *
 * An assignment with no environments - an older core that sends none, a system
 * with none, or a satellite scoped out with `[]` - yields a single env-less
 * run, which is exactly the pre-fan-out behaviour.
 */
export function expandRuns(
  assignments: SatelliteAssignment[],
): ScheduledRun[] {
  return assignments.flatMap((assignment): ScheduledRun[] => {
    const environments = assignment.environments ?? [];
    return environments.length === 0
      ? [{ assignment, environment: null }]
      : environments.map((environment) => ({ assignment, environment }));
  });
}
