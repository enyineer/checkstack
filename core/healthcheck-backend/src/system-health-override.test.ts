import { describe, expect, it } from "bun:test";
import {
  applySystemHealthOverrides,
  worstHealthStatus,
  type SystemHealthOverrideInput,
} from "./system-health-override";
import type { SystemHealthStatusResponse } from "@checkstack/healthcheck-common";

const at = new Date("2026-07-05T00:00:00.000Z");

function base(
  status: SystemHealthStatusResponse["status"],
): SystemHealthStatusResponse {
  return { status, evaluatedAt: at, checkStatuses: [] };
}

function override(
  status: "degraded" | "unhealthy",
  sourceId: string,
): SystemHealthOverrideInput {
  return {
    status,
    source: "incident",
    reason: `Incident ${sourceId}`,
    sourceId,
  };
}

describe("worstHealthStatus", () => {
  it("orders unhealthy > degraded > healthy", () => {
    expect(worstHealthStatus("healthy", "degraded")).toBe("degraded");
    expect(worstHealthStatus("degraded", "unhealthy")).toBe("unhealthy");
    expect(worstHealthStatus("unhealthy", "degraded")).toBe("unhealthy");
    expect(worstHealthStatus("healthy", "healthy")).toBe("healthy");
  });
});

describe("applySystemHealthOverrides", () => {
  it("returns the base unchanged (no override field) when there are no overrides", () => {
    const result = applySystemHealthOverrides({
      base: base("healthy"),
      overrides: [],
    });
    expect(result.status).toBe("healthy");
    expect(result.override).toBeUndefined();
  });

  it("raises a healthy system to the override status and records the source", () => {
    const result = applySystemHealthOverrides({
      base: base("healthy"),
      overrides: [override("unhealthy", "inc-1")],
    });
    expect(result.status).toBe("unhealthy");
    expect(result.override).toEqual({
      status: "unhealthy",
      source: "incident",
      reason: "Incident inc-1",
      sourceId: "inc-1",
    });
  });

  it("applies an override even when the system has no health checks", () => {
    const result = applySystemHealthOverrides({
      base: base("healthy"), // no-checks default is healthy
      overrides: [override("degraded", "inc-2")],
    });
    expect(result.status).toBe("degraded");
    expect(result.override?.status).toBe("degraded");
  });

  it("keeps the worse HEALTH CHECK status when a check is worse than the override", () => {
    // Override says degraded, but a check reports unhealthy -> unhealthy wins.
    const result = applySystemHealthOverrides({
      base: base("unhealthy"),
      overrides: [override("degraded", "inc-3")],
    });
    expect(result.status).toBe("unhealthy");
    // The override is still surfaced (it contributed), at its own status.
    expect(result.override?.status).toBe("degraded");
  });

  it("picks the worst override when several incidents override the same system", () => {
    const result = applySystemHealthOverrides({
      base: base("healthy"),
      overrides: [
        override("degraded", "inc-a"),
        override("unhealthy", "inc-b"),
        override("degraded", "inc-c"),
      ],
    });
    expect(result.status).toBe("unhealthy");
    expect(result.override?.sourceId).toBe("inc-b");
  });
});
