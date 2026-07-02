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

  it("clips an over-long environment name with an ellipsis to keep one line", () => {
    const content = buildRunActivityContent({
      systemName: "Checkout",
      configurationName: "HTTP ping",
      status: "healthy",
      environmentName: "us-east-1-production-blue-green-cluster",
    });
    expect(content).toBe(
      "Checkout (HTTP ping) @ us-east-1-production-bl… → healthy",
    );
  });

  it("leaves an environment name at the length limit untouched", () => {
    const environmentName = "production-cluster-eu-01"; // exactly 24 chars
    expect(environmentName.length).toBe(24);
    const content = buildRunActivityContent({
      systemName: "Checkout",
      configurationName: "HTTP ping",
      status: "healthy",
      environmentName,
    });
    expect(content).toBe(
      "Checkout (HTTP ping) @ production-cluster-eu-01 → healthy",
    );
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
