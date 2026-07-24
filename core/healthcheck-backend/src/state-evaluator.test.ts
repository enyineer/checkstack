import { describe, expect, test } from "bun:test";
import { evaluateHealthStatus } from "./state-evaluator";
import type {
  HealthCheckStatus,
  ConsecutiveThresholds,
  WindowThresholds,
} from "@checkstack/healthcheck-common";

// Helper to create runs with timestamps
function createRuns(
  statuses: HealthCheckStatus[]
): { status: HealthCheckStatus; timestamp: Date }[] {
  const now = Date.now();
  return statuses.map((status, i) => ({
    status,
    timestamp: new Date(now - i * 60000), // 1 minute apart, newest first
  }));
}

describe("evaluateHealthStatus", () => {
  describe("with no runs", () => {
    test("returns healthy when no runs exist", () => {
      const result = evaluateHealthStatus({ runs: [] });
      expect(result).toBe("healthy");
    });
  });

  describe("consecutive mode", () => {
    const thresholds: ConsecutiveThresholds = {
      mode: "consecutive",
      healthy: { minSuccessCount: 2 },
      degraded: { minFailureCount: 2 },
      unhealthy: { minFailureCount: 4 },
    };

    test("returns healthy after minSuccessCount consecutive successes", () => {
      const runs = createRuns(["healthy", "healthy", "unhealthy"]);
      expect(evaluateHealthStatus({ runs, thresholds })).toBe("healthy");
    });

    test("returns healthy with exactly minSuccessCount successes", () => {
      const runs = createRuns(["healthy", "healthy"]);
      expect(evaluateHealthStatus({ runs, thresholds })).toBe("healthy");
    });

    test("returns degraded after minFailureCount consecutive failures", () => {
      const runs = createRuns(["unhealthy", "degraded", "healthy"]);
      expect(evaluateHealthStatus({ runs, thresholds })).toBe("degraded");
    });

    test("returns unhealthy after higher minFailureCount", () => {
      const runs = createRuns([
        "unhealthy",
        "unhealthy",
        "degraded",
        "unhealthy",
        "healthy",
      ]);
      expect(evaluateHealthStatus({ runs, thresholds })).toBe("unhealthy");
    });

    test("returns latest status when not enough history", () => {
      const runs = createRuns(["healthy"]); // Only 1 run, needs 2 for healthy
      expect(evaluateHealthStatus({ runs, thresholds })).toBe("healthy");
    });

    test("handles mix of degraded and unhealthy as failures", () => {
      const runs = createRuns(["degraded", "unhealthy"]);
      expect(evaluateHealthStatus({ runs, thresholds })).toBe("degraded");
    });

    test("resets count when streak breaks", () => {
      // Latest: 1 healthy, then failures - should use latest status
      const runs = createRuns(["healthy", "unhealthy", "unhealthy"]);
      expect(evaluateHealthStatus({ runs, thresholds })).toBe("healthy");
    });
  });

  describe("window mode", () => {
    const thresholds: WindowThresholds = {
      mode: "window",
      windowSize: 5,
      degraded: { minFailureCount: 2 },
      unhealthy: { minFailureCount: 4 },
    };

    test("returns healthy when failures below threshold", () => {
      const runs = createRuns([
        "healthy",
        "unhealthy",
        "healthy",
        "healthy",
        "healthy",
      ]);
      expect(evaluateHealthStatus({ runs, thresholds })).toBe("healthy");
    });

    test("returns degraded when failures at degraded threshold", () => {
      const runs = createRuns([
        "unhealthy",
        "unhealthy",
        "healthy",
        "healthy",
        "healthy",
      ]);
      expect(evaluateHealthStatus({ runs, thresholds })).toBe("degraded");
    });

    test("returns unhealthy when failures at unhealthy threshold", () => {
      const runs = createRuns([
        "unhealthy",
        "degraded",
        "unhealthy",
        "unhealthy",
        "healthy",
      ]);
      expect(evaluateHealthStatus({ runs, thresholds })).toBe("unhealthy");
    });

    test("only considers runs within window size", () => {
      // Window is 5, so old failures outside window don't count
      const runs = createRuns([
        "healthy",
        "healthy",
        "healthy",
        "healthy",
        "healthy",
        "unhealthy", // Outside window
        "unhealthy",
        "unhealthy",
        "unhealthy",
      ]);
      expect(evaluateHealthStatus({ runs, thresholds })).toBe("healthy");
    });

    test("handles window smaller than run count", () => {
      const smallWindowThresholds: WindowThresholds = {
        mode: "window",
        windowSize: 3,
        degraded: { minFailureCount: 2 },
        unhealthy: { minFailureCount: 3 },
      };
      const runs = createRuns([
        "unhealthy",
        "unhealthy",
        "healthy",
        "unhealthy",
      ]);
      expect(
        evaluateHealthStatus({ runs, thresholds: smallWindowThresholds })
      ).toBe("degraded");
    });
  });

  describe("default thresholds", () => {
    test("uses default consecutive mode when thresholds not provided", () => {
      // Default: healthy after 1 success, degraded after 2 failures, unhealthy after 5
      const runs = createRuns(["healthy"]);
      expect(evaluateHealthStatus({ runs })).toBe("healthy");
    });

    test("default degraded after 2 consecutive failures", () => {
      const runs = createRuns(["unhealthy", "unhealthy"]);
      expect(evaluateHealthStatus({ runs })).toBe("degraded");
    });

    test("default unhealthy after 5 consecutive failures", () => {
      const runs = createRuns([
        "unhealthy",
        "unhealthy",
        "unhealthy",
        "unhealthy",
        "unhealthy",
      ]);
      expect(evaluateHealthStatus({ runs })).toBe("unhealthy");
    });
  });

  describe("transient failure (single blip) does not escalate", () => {
    test("default thresholds: one failure then recovery never leaves healthy", () => {
      // Reproduces the real-world bug: an assignment fails once (e.g. a check
      // timeout) and recovers on the next run. Default degraded threshold is 2
      // consecutive failures, so a single failure must NOT escalate to
      // degraded/unhealthy (which would fire a "System health critical"
      // notification).

      // After the single failing run (only one run recorded so far).
      expect(evaluateHealthStatus({ runs: createRuns(["unhealthy"]) })).toBe(
        "healthy"
      );

      // After the next run succeeds.
      expect(
        evaluateHealthStatus({ runs: createRuns(["healthy", "unhealthy"]) })
      ).toBe("healthy");
    });

    test("single leading failure below degraded threshold stays healthy", () => {
      const thresholds: ConsecutiveThresholds = {
        mode: "consecutive",
        healthy: { minSuccessCount: 1 },
        degraded: { minFailureCount: 2 },
        unhealthy: { minFailureCount: 3 },
      };
      // Most recent run failed once, then a flicker of success, then failures.
      // The leading failure streak is only 1 (< degraded threshold of 2), so
      // consecutive mode must NOT report unhealthy off the single latest
      // failure.
      const runs = createRuns([
        "unhealthy",
        "healthy",
        "unhealthy",
        "unhealthy",
        "unhealthy",
      ]);
      expect(evaluateHealthStatus({ runs, thresholds })).toBe("healthy");
    });
  });

  describe("flickering scenarios", () => {
    test("window mode catches a mostly-failing system consecutive mode ignores", () => {
      // System that is mostly failing but occasionally succeeds, with the most
      // recent run a single failure after a flicker of success.
      const runs = createRuns([
        "unhealthy",
        "healthy", // Flicker
        "unhealthy",
        "unhealthy",
        "unhealthy",
      ]);

      const consecutiveThresholds: ConsecutiveThresholds = {
        mode: "consecutive",
        healthy: { minSuccessCount: 1 },
        degraded: { minFailureCount: 2 },
        unhealthy: { minFailureCount: 3 },
      };

      const windowThresholds: WindowThresholds = {
        mode: "window",
        windowSize: 5,
        degraded: { minFailureCount: 2 },
        unhealthy: { minFailureCount: 4 },
      };

      // Consecutive: only the leading streak counts (1 failure, below the
      // degraded threshold), so it stays healthy and does not over-react to the
      // single most-recent failure.
      expect(
        evaluateHealthStatus({ runs, thresholds: consecutiveThresholds })
      ).toBe("healthy");

      // Window: sees 4 failures in window of 5, returns unhealthy. This is why
      // window mode is preferable for intermittently-failing systems.
      expect(evaluateHealthStatus({ runs, thresholds: windowThresholds })).toBe(
        "unhealthy"
      );
    });

    test("window mode shows recovery when mostly healthy", () => {
      const runs = createRuns([
        "healthy",
        "unhealthy", // Flicker
        "healthy",
        "healthy",
        "healthy",
      ]);

      const windowThresholds: WindowThresholds = {
        mode: "window",
        windowSize: 5,
        degraded: { minFailureCount: 2 },
        unhealthy: { minFailureCount: 4 },
      };

      // Only 1 failure in window - still healthy
      expect(evaluateHealthStatus({ runs, thresholds: windowThresholds })).toBe(
        "healthy"
      );
    });
  });
  describe("interleaved streams (why callers must slice per environment AND source)", () => {
    // This documents the MECHANISM behind a reported bug: a system whose local
    // check passed and whose satellite check failed every time read HEALTHY.
    // The evaluator is deliberately stream-agnostic - it assumes the runs it is
    // handed come from ONE stream - so mixing two locations' runs into one call
    // silently destroys the signal. `getSystemHealthStatus` must therefore
    // evaluate one (environment, source) slice per call; these tests fail loudly
    // if anyone re-collapses that slicing.
    const thresholds: ConsecutiveThresholds = {
      mode: "consecutive",
      healthy: { minSuccessCount: 2 },
      degraded: { minFailureCount: 2 },
      unhealthy: { minFailureCount: 3 },
    };

    test("a permanently failing stream is MASKED when interleaved with a healthy one", () => {
      // Local healthy alternating with satellite unhealthy: the streak breaks on
      // every run, so neither threshold is ever met and evaluation falls through
      // to its healthy default - even though one location has never succeeded.
      const interleaved = createRuns([
        "healthy",
        "unhealthy",
        "healthy",
        "unhealthy",
        "healthy",
        "unhealthy",
      ]);
      expect(evaluateHealthStatus({ runs: interleaved, thresholds })).toBe(
        "healthy",
      );
    });

    test("the same runs, sliced per source, report the failing location", () => {
      // The fix: hand the evaluator one stream at a time.
      expect(
        evaluateHealthStatus({
          runs: createRuns(["healthy", "healthy", "healthy"]),
          thresholds,
        }),
      ).toBe("healthy");
      expect(
        evaluateHealthStatus({
          runs: createRuns(["unhealthy", "unhealthy", "unhealthy"]),
          thresholds,
        }),
      ).toBe("unhealthy");
      // Worst-wins across the two slices then carries the check to unhealthy.
    });
  });
});
