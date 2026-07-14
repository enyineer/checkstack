/**
 * Process-local registry of satellite-side telemetry PULL executors, keyed by
 * qualified source type id.
 *
 * EXECUTION CONSTRAINT (inherent to satellites): the agent can only run pull
 * logic STATICALLY compiled into the satellite build. A satellite-capable source
 * type ships a pure {@link SatellitePullExecutor} in a `*-common` leaf the
 * satellite imports, and registers it here at module load. The pull scheduler
 * resolves the executor for an assigned instance by its `sourceTypeId`; an
 * instance whose type has NO registered executor produces a per-instance
 * `capability_status` error (never a crash).
 *
 * V1: NO executors are registered - this registry is only the SEAM a future
 * satellite-capable type plugs into (the satellite build would statically import
 * that type's `register...Executor()` here). It exists so the scheduler has a
 * stable lookup point and so the "type not available on this build" path is real
 * and tested.
 */

import type { SatellitePullExecutor } from "@checkstack/telemetry-common";

export class TelemetryPullExecutorRegistry {
  private readonly executors = new Map<string, SatellitePullExecutor>();

  /** Register an executor for its source type id; a duplicate throws. */
  register(executor: SatellitePullExecutor): void {
    if (this.executors.has(executor.sourceTypeId)) {
      throw new Error(
        `telemetry-pull: duplicate executor for source type "${executor.sourceTypeId}"`,
      );
    }
    this.executors.set(executor.sourceTypeId, executor);
  }

  /** The executor for a source type id, or undefined when none is compiled in. */
  get(sourceTypeId: string): SatellitePullExecutor | undefined {
    return this.executors.get(sourceTypeId);
  }

  /** Every registered executor. */
  list(): SatellitePullExecutor[] {
    return [...this.executors.values()];
  }
}

/**
 * The process-wide registry the satellite build imports and (in a future
 * version) registers static executors into. The scheduler resolves through it.
 */
export const telemetryPullExecutorRegistry =
  new TelemetryPullExecutorRegistry();
