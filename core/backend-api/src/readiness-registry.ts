/**
 * Result of a single readiness probe.
 */
export interface ReadinessCheckResult {
  ok: boolean;
  /** Optional human-readable detail (shown verbatim in the /ready response). */
  message?: string;
}

/**
 * Single readiness check. The platform calls these in parallel from `/ready`.
 *
 * Implementations should return quickly (target < 1s). Long-running probes
 * should cache their last result and refresh in the background — the
 * `/ready` endpoint is hit by orchestrators (k8s, docker-compose) on a tight
 * loop and slow probes will produce false-negative restarts.
 */
export interface ReadinessCheck {
  /** Probe name (e.g. "database", "queue", "auth-strategy-loaded"). */
  name: string;
  /** True if this probe should block startup. False = informational only. */
  critical?: boolean;
  check: () => Promise<ReadinessCheckResult>;
}

/**
 * Plugin-facing API for contributing readiness probes to the `/ready` endpoint.
 *
 * The core platform always contributes a "core.init" probe that flips ready
 * once `init()` has resolved. Plugins may add their own (e.g. "queue.connected",
 * "auth.strategy-registered") to gate the platform from accepting traffic until
 * their preconditions are met.
 *
 * @example
 * ```ts
 * registerInit({
 *   deps: { readiness: coreServices.readinessRegistry },
 *   async init({ readiness }) {
 *     readiness.register({
 *       name: "queue.connected",
 *       critical: true,
 *       check: async () => ({
 *         ok: pool.isConnected(),
 *         message: pool.isConnected() ? undefined : "queue pool not connected",
 *       }),
 *     });
 *   },
 * });
 * ```
 */
export interface ReadinessRegistry {
  register(check: ReadinessCheck): void;
}
