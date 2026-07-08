/**
 * Pod-local bulkhead for slot-hogging ("suspect") health-check jobs.
 *
 * A correlated outage can turn hundreds of checks into slot-hoggers at once. The
 * work-conserving bulkhead caps how many suspect jobs may HOLD a worker slot
 * concurrently on this pod, so healthy checks keep draining. It is deliberately
 * NON-BLOCKING: a suspect job that cannot be admitted is skipped for this tick
 * (freeing its worker slot immediately) rather than queued behind the lane -
 * queueing would just move the starvation back into the shared worker pool.
 *
 * Two admission gates, combined:
 *   - single-flight: at most ONE in-flight run per `(configId, systemId)` job
 *     key, so a recurring fire that arrives while the previous slow run is still
 *     executing is dropped instead of stacking up (no buildup).
 *   - capacity: at most `capacity` suspect jobs holding a slot at once.
 *
 * This is pod-local infrastructure, exactly like the queue's own concurrency
 * semaphore: total suspect concurrency across the cluster is `capacity x pods`,
 * scaling the same way queue concurrency already does. The CLASSIFICATION that
 * decides which jobs are suspect derives from durable run history (globally
 * consistent); only this admission bookkeeping is per-pod.
 */

export type AdmissionDenial = "in_flight" | "lane_full";

export type AdmissionResult =
  | { admitted: true }
  | { admitted: false; reason: AdmissionDenial };

export class SuspectLane {
  private held = 0;
  private readonly inFlight = new Set<string>();

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(`SuspectLane capacity must be a positive integer, got ${capacity}`);
    }
  }

  /**
   * Try to admit a suspect job. On `admitted: true` the caller MUST call
   * `release(key)` exactly once (in a `finally`) when the run completes.
   */
  tryAdmit(key: string): AdmissionResult {
    if (this.inFlight.has(key)) return { admitted: false, reason: "in_flight" };
    if (this.held >= this.capacity) return { admitted: false, reason: "lane_full" };
    this.held++;
    this.inFlight.add(key);
    return { admitted: true };
  }

  /** Release a previously-admitted key. Idempotent for an unknown key. */
  release(key: string): void {
    if (this.inFlight.delete(key)) this.held--;
  }

  /** Number of suspect jobs currently holding a slot (for metrics/tests). */
  get active(): number {
    return this.held;
  }
}
