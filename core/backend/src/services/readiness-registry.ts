import type {
  ReadinessCheck,
  ReadinessCheckResult,
  ReadinessRegistry,
} from "@checkstack/backend-api";
import { extractErrorMessage } from "@checkstack/common";
import { rootLogger } from "../logger";

/**
 * Snapshot returned to /ready callers.
 */
export interface ReadinessSnapshot {
  ready: boolean;
  checks: Array<{
    name: string;
    critical: boolean;
    ok: boolean;
    message?: string;
    /** Set when the probe threw (treated as ok=false for critical checks). */
    error?: string;
    /** Wall-clock duration for the probe (milliseconds). */
    durationMs: number;
  }>;
}

/**
 * Core implementation backing both `coreServices.readinessRegistry` (plugin-facing)
 * and the `/ready` endpoint (server-facing). Plugins call `register`; the server
 * calls `evaluate()`.
 */
export class CoreReadinessRegistry {
  private checks: ReadinessCheck[] = [];

  register(check: ReadinessCheck): void {
    if (this.checks.some((c) => c.name === check.name)) {
      rootLogger.warn(
        `ReadinessRegistry: probe '${check.name}' is already registered. Overwriting.`,
      );
      this.checks = this.checks.filter((c) => c.name !== check.name);
    }
    this.checks.push(check);
    rootLogger.debug(
      `   -> Registered readiness probe '${check.name}' (critical=${check.critical ?? true})`,
    );
  }

  /**
   * Run every probe in parallel. Critical failures set `ready = false`.
   * Throws are caught and reported as `ok: false`.
   */
  async evaluate(): Promise<ReadinessSnapshot> {
    const results = await Promise.all(
      this.checks.map(async (c) => {
        const start = performance.now();
        const critical = c.critical ?? true;
        try {
          const r: ReadinessCheckResult = await c.check();
          return {
            name: c.name,
            critical,
            ok: r.ok,
            message: r.message,
            durationMs: Math.round(performance.now() - start),
          };
        } catch (error) {
          return {
            name: c.name,
            critical,
            ok: false,
            error: extractErrorMessage(error, String(error)),
            durationMs: Math.round(performance.now() - start),
          };
        }
      }),
    );

    const ready = results.every((r) => r.ok || !r.critical);
    return { ready, checks: results };
  }

  /**
   * Returns true while no probes are registered. Used to give a stable answer
   * before plugins have had a chance to register their checks.
   */
  isEmpty(): boolean {
    return this.checks.length === 0;
  }
}

/**
 * Plugin-facing scoped view (currently identical to the underlying registry —
 * we intentionally don't namespace probe names by plugin so operators can read
 * them at a glance, but plugins are encouraged to prefix their own names).
 */
export function createScopedReadinessRegistry(
  global: CoreReadinessRegistry,
): ReadinessRegistry {
  return {
    register(check: ReadinessCheck) {
      global.register(check);
    },
  };
}
