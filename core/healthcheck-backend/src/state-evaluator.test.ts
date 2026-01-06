import { describe, expect, test } from "bun:test";
import { evaluateHealthStatus } from "./state-evaluator";
import type {
  HealthCheckStatus,
  ConsecutiveThresholds,
  WindowThresholds,
} from "@checkmate-monitor/healthcheck-common";

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

  describe("flickering scenarios", () => {
    test("window mode handles flickering better than consecutive", () => {
      // System that is mostly failing but occasionally succeeds
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

      // Consecutive: sees only 1 failure at start, returns unhealthy (just the first)
      expect(
        evaluateHealthStatus({ runs, thresholds: consecutiveThresholds })
      ).toBe("unhealthy");

      // Window: sees 4 failures in window of 5, returns unhealthy
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
});
