import { describe, expect, it } from "bun:test";
import { buildRunActivityContent } from "./recentActivity";

describe("buildRunActivityContent", () => {
  it("includes the environment name when the run was fanned out to one", () => {
    const content = buildRunActivityContent({
      systemName: "Checkout",
      configurationName: "HTTP ping",
      status: "healthy",
      environmentName: "Production",
    });
    expect(content).toBe("Checkout (HTTP ping) @ Production → healthy");
  });

  it("omits the environment for a run that is not environment-scoped", () => {
    const content = buildRunActivityContent({
      systemName: "Checkout",
      configurationName: "HTTP ping",
      status: "healthy",
    });
    // Must match the pre-existing format exactly so env-less runs are unchanged.
    expect(content).toBe("Checkout (HTTP ping) → healthy");
  });

  it("treats an empty-string environment name as no environment", () => {
    const content = buildRunActivityContent({
      systemName: "Checkout",
      configurationName: "HTTP ping",
      status: "degraded",
      environmentName: "",
    });
    expect(content).toBe("Checkout (HTTP ping) → degraded");
  });

  it("renders each status the same way regardless of environment presence", () => {
    for (const status of ["healthy", "degraded", "unhealthy"] as const) {
      expect(
        buildRunActivityContent({
          systemName: "Sys",
          configurationName: "Cfg",
          status,
        }),
      ).toBe(`Sys (Cfg) → ${status}`);
      expect(
        buildRunActivityContent({
          systemName: "Sys",
          configurationName: "Cfg",
          status,
          environmentName: "Staging",
        }),
      ).toBe(`Sys (Cfg) @ Staging → ${status}`);
    }
  });
});
