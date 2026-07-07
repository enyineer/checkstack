import { describe, expect, test } from "bun:test";
import {
  classifySlowCheck,
  ENV_LESS_KEY,
  type RecentRun,
} from "./slow-check-classifier";
import type { HealthCheckStatus } from "@checkstack/healthcheck-common";

const TIMEOUT = 30_000;
const SLOW = TIMEOUT * 0.8; // 24_000

// Build newest-first runs for one env.
function runs(
  entries: Array<{ status: HealthCheckStatus; latencyMs: number | null; env?: string | null }>,
): RecentRun[] {
  const now = Date.now();
  return entries.map((e, i) => ({
    status: e.status,
    latencyMs: e.latencyMs,
    environmentId: e.env === undefined ? null : e.env,
    timestamp: new Date(now - i * 60_000),
  }));
}

describe("classifySlowCheck", () => {
  test("env-less: 3 slow timeouts => suspect", () => {
    const r = runs([
      { status: "unhealthy", latencyMs: SLOW },
      { status: "unhealthy", latencyMs: SLOW },
      { status: "unhealthy", latencyMs: SLOW },
    ]);
    const c = classifySlowCheck({ runs: r, params: { configuredTimeoutMs: TIMEOUT } });
    expect(c.perEnv.get(ENV_LESS_KEY)?.suspect).toBe(true);
  });

  test("fast connect-refused (low latency) is NOT suspect - it frees its slot", () => {
    const r = runs([
      { status: "unhealthy", latencyMs: 5 },
      { status: "unhealthy", latencyMs: 8 },
      { status: "unhealthy", latencyMs: 3 },
    ]);
    const c = classifySlowCheck({ runs: r, params: { configuredTimeoutMs: TIMEOUT } });
    expect(c.perEnv.get(ENV_LESS_KEY)?.suspect).toBe(false);
  });

  test("one recent healthy run clears suspect (streak broken)", () => {
    const r = runs([
      { status: "healthy", latencyMs: 200 },
      { status: "unhealthy", latencyMs: SLOW },
      { status: "unhealthy", latencyMs: SLOW },
      { status: "unhealthy", latencyMs: SLOW },
    ]);
    const c = classifySlowCheck({ runs: r, params: { configuredTimeoutMs: TIMEOUT } });
    expect(c.perEnv.get(ENV_LESS_KEY)?.suspect).toBe(false);
  });

  test("mixed envs: only the failing env is suspect; the healthy sibling is not", () => {
    // The common multi-stage case: one env down, siblings healthy. The failing
    // env is isolated per-env; the healthy sibling keeps running untouched.
    const suspectEnv = runs([
      { status: "unhealthy", latencyMs: SLOW, env: "prod" },
      { status: "unhealthy", latencyMs: SLOW, env: "prod" },
      { status: "unhealthy", latencyMs: SLOW, env: "prod" },
    ]);
    const healthyEnv = runs([
      { status: "healthy", latencyMs: 150, env: "staging" },
      { status: "healthy", latencyMs: 160, env: "staging" },
    ]);
    const c = classifySlowCheck({
      runs: [...suspectEnv, ...healthyEnv],
      params: { configuredTimeoutMs: TIMEOUT },
    });
    expect(c.perEnv.get("prod")?.suspect).toBe(true);
    expect(c.perEnv.get("staging")?.suspect).toBe(false);
  });

  test("each env is classified independently", () => {
    const prod = runs([
      { status: "unhealthy", latencyMs: SLOW, env: "prod" },
      { status: "unhealthy", latencyMs: SLOW, env: "prod" },
      { status: "unhealthy", latencyMs: SLOW, env: "prod" },
    ]);
    const staging = runs([
      { status: "unhealthy", latencyMs: SLOW, env: "staging" },
      { status: "unhealthy", latencyMs: SLOW, env: "staging" },
      { status: "unhealthy", latencyMs: SLOW, env: "staging" },
    ]);
    const c = classifySlowCheck({
      runs: [...prod, ...staging],
      params: { configuredTimeoutMs: TIMEOUT },
    });
    expect(c.perEnv.get("prod")?.suspect).toBe(true);
    expect(c.perEnv.get("staging")?.suspect).toBe(true);
  });

  test("healthyBaselineMs is p95 of HEALTHY runs only (excludes timed-out runs)", () => {
    const r = runs([
      { status: "unhealthy", latencyMs: SLOW }, // excluded from baseline
      { status: "healthy", latencyMs: 100 },
      { status: "healthy", latencyMs: 120 },
      { status: "healthy", latencyMs: 110 },
    ]);
    const c = classifySlowCheck({ runs: r, params: { configuredTimeoutMs: TIMEOUT } });
    const env = c.perEnv.get(ENV_LESS_KEY);
    expect(env?.healthyBaselineMs).toBeDefined();
    expect(env?.healthyBaselineMs).toBeLessThanOrEqual(120);
    expect(env?.healthyBaselineMs).toBeGreaterThanOrEqual(100);
  });

  test("no healthy runs => healthyBaselineMs undefined (adaptive timeout won't shrink)", () => {
    const r = runs([
      { status: "unhealthy", latencyMs: SLOW },
      { status: "unhealthy", latencyMs: SLOW },
      { status: "unhealthy", latencyMs: SLOW },
    ]);
    const c = classifySlowCheck({ runs: r, params: { configuredTimeoutMs: TIMEOUT } });
    expect(c.perEnv.get(ENV_LESS_KEY)?.healthyBaselineMs).toBeUndefined();
  });

  test("recovery probe fires on the Nth consecutive suspect run", () => {
    // 5 consecutive slow failures, recoveryProbeEvery=5 => 5 % 5 === 0 => probe.
    const r = runs(
      Array.from({ length: 5 }, () => ({
        status: "unhealthy" as HealthCheckStatus,
        latencyMs: SLOW,
      })),
    );
    const c = classifySlowCheck({
      runs: r,
      params: { configuredTimeoutMs: TIMEOUT, recoveryProbeEvery: 5 },
    });
    expect(c.perEnv.get(ENV_LESS_KEY)?.isRecoveryProbe).toBe(true);
  });

  test("no probe when streak is not a multiple of the cadence", () => {
    const r = runs(
      Array.from({ length: 3 }, () => ({
        status: "unhealthy" as HealthCheckStatus,
        latencyMs: SLOW,
      })),
    );
    const c = classifySlowCheck({
      runs: r,
      params: { configuredTimeoutMs: TIMEOUT, recoveryProbeEvery: 5, consecutiveFailures: 3 },
    });
    const env = c.perEnv.get(ENV_LESS_KEY);
    expect(env?.suspect).toBe(true);
    expect(env?.isRecoveryProbe).toBe(false); // 3 % 5 !== 0
  });

  test("empty history => no classified envs", () => {
    const c = classifySlowCheck({ runs: [], params: { configuredTimeoutMs: TIMEOUT } });
    expect(c.perEnv.size).toBe(0);
  });
});
