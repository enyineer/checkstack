import type {
  StateThresholds,
  ConsecutiveThresholds,
  WindowThresholds,
  HealthCheckStatus,
} from "@checkmate-monitor/healthcheck-common";
import { DEFAULT_STATE_THRESHOLDS } from "@checkmate-monitor/healthcheck-common";

interface RunForEvaluation {
  status: HealthCheckStatus;
  timestamp: Date;
}

/**
 * Evaluates the current health status based on recent runs and configured thresholds.
 * Returns the evaluated status based on the threshold mode.
 *
 * @param runs - Recent health check runs, sorted by timestamp descending (newest first)
 * @param thresholds - State threshold configuration (uses defaults if not provided)
 */
export function evaluateHealthStatus(props: {
  runs: RunForEvaluation[];
  thresholds?: StateThresholds;
}): HealthCheckStatus {
  const { runs, thresholds = DEFAULT_STATE_THRESHOLDS } = props;

  if (runs.length === 0) {
    // No runs yet - assume healthy (matches current behavior)
    return "healthy";
  }

  return thresholds.mode === "consecutive"
    ? evaluateConsecutive({ runs, thresholds })
    : evaluateWindow({ runs, thresholds });
}

/**
 * Consecutive mode: evaluates based on sequential identical results from most recent.
 */
function evaluateConsecutive(props: {
  runs: RunForEvaluation[];
  thresholds: ConsecutiveThresholds;
}): HealthCheckStatus {
  const { runs, thresholds } = props;

  // Count consecutive identical results from most recent
  let consecutiveFailures = 0;
  let consecutiveSuccesses = 0;

  for (const run of runs) {
    if (run.status === "healthy") {
      if (consecutiveFailures === 0) {
        consecutiveSuccesses++;
      } else {
        break; // Streak ended
      }
    } else {
      // degraded or unhealthy both count as failures for threshold purposes
      if (consecutiveSuccesses === 0) {
        consecutiveFailures++;
      } else {
        break; // Streak ended
      }
    }
  }

  // Evaluate thresholds (unhealthy > degraded > healthy)
  if (consecutiveFailures >= thresholds.unhealthy.minFailureCount) {
    return "unhealthy";
  }
  if (consecutiveFailures >= thresholds.degraded.minFailureCount) {
    return "degraded";
  }
  if (consecutiveSuccesses >= thresholds.healthy.minSuccessCount) {
    return "healthy";
  }

  // Edge case: not enough history to determine - use latest individual status
  return runs[0].status;
}

/**
 * Window mode: evaluates based on failure count within a sliding window.
 * Better for flickering systems where failures are intermittent.
 */
function evaluateWindow(props: {
  runs: RunForEvaluation[];
  thresholds: WindowThresholds;
}): HealthCheckStatus {
  const { runs, thresholds } = props;

  // Take only the window size worth of runs
  const windowRuns = runs.slice(0, thresholds.windowSize);
  const failureCount = windowRuns.filter((r) => r.status !== "healthy").length;

  // Evaluate thresholds (unhealthy > degraded > healthy)
  if (failureCount >= thresholds.unhealthy.minFailureCount) {
    return "unhealthy";
  }
  if (failureCount >= thresholds.degraded.minFailureCount) {
    return "degraded";
  }

  return "healthy";
}
