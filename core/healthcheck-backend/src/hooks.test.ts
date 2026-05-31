import { describe, it, expect } from "bun:test";
import { healthCheckHooks } from "./hooks";

describe("Health Check Hooks", () => {
  // The directional/umbrella system-health hooks were removed in Phase 4
  // (§10.3) — the `health` entity drives those events now. The remaining
  // hooks are the KEPT non-entity signals.
  it("keeps the assignmentChanged config-change hook", () => {
    expect(healthCheckHooks.assignmentChanged.id).toBe(
      "healthcheck.assignment.changed",
    );
  });

  it("keeps the raw-sample checkCompleted / checkFailed hooks", () => {
    expect(healthCheckHooks.checkCompleted.id).toBe(
      "healthcheck.check.completed",
    );
    expect(healthCheckHooks.checkFailed.id).toBe("healthcheck.check.failed");
  });

  it("no longer exposes the removed system-health or flapping hooks", () => {
    expect("systemDegraded" in healthCheckHooks).toBe(false);
    expect("systemHealthy" in healthCheckHooks).toBe(false);
    expect("systemHealthChanged" in healthCheckHooks).toBe(false);
    // Flapping moved to the automation engine's windowed-count gate; the
    // pre-derived flapping signal hook was removed.
    expect("flappingDetected" in healthCheckHooks).toBe(false);
  });
});
