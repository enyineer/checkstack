import { describe, it, expect } from "bun:test";
import { buildHealthTransitionNotification } from "./health-notification-content";

describe("buildHealthTransitionNotification", () => {
  const base = {
    systemId: "sys-1",
    systemName: "Payments API",
    configurationId: "cfg-9",
    checkName: "HTTP 200 probe",
    newStatus: "unhealthy" as const,
  };

  it("names the failing check in the body for an unhealthy transition", () => {
    const payload = buildHealthTransitionNotification({
      ...base,
      transition: "escalation",
    });
    expect(payload.body).toContain('Health check **"HTTP 200 probe"**');
    expect(payload.body).toContain("**Payments API**");
    expect(payload.importance).toBe("critical");
  });

  it("names the failing check for a degraded transition", () => {
    const payload = buildHealthTransitionNotification({
      ...base,
      newStatus: "degraded",
      transition: "escalation",
    });
    expect(payload.body).toContain('Health check **"HTTP 200 probe"**');
    expect(payload.importance).toBe("warning");
  });

  it("pushes a healthcheck.healthcheck subject alongside the system subject", () => {
    const payload = buildHealthTransitionNotification({
      ...base,
      transition: "escalation",
    });
    const subjects = payload.subjects ?? [];
    expect(subjects).toHaveLength(2);
    expect(subjects[0]).toMatchObject({
      kind: "catalog.system",
      id: "sys-1",
      name: "Payments API",
    });
    expect(subjects[1]).toMatchObject({
      kind: "healthcheck.healthcheck",
      id: "cfg-9",
      name: "HTTP 200 probe",
      status: "unhealthy",
    });
    // Check subject deep-links to its run history.
    expect(subjects[1]?.url).toContain("sys-1");
    expect(subjects[1]?.url).toContain("cfg-9");
  });

  it("falls back to the configuration id when no name is resolved", () => {
    const payload = buildHealthTransitionNotification({
      ...base,
      checkName: "cfg-9",
      transition: "escalation",
    });
    expect(payload.body).toContain('Health check **"cfg-9"**');
    expect((payload.subjects ?? [])[1]).toMatchObject({ name: "cfg-9" });
  });

  it("qualifies the body with the environment name when env-scoped", () => {
    const payload = buildHealthTransitionNotification({
      ...base,
      transition: "escalation",
      environmentId: "env-prod",
      environmentName: "Production",
    });
    expect(payload.body).toContain("in environment **Production**");
    expect(payload.title).toContain("(Production)");
  });

  it("stays system-level and omits the check subject on recovery", () => {
    const payload = buildHealthTransitionNotification({
      ...base,
      newStatus: "healthy",
      transition: "recovery",
    });
    expect(payload.body).not.toContain("Health check **");
    expect(payload.importance).toBe("info");
    const subjects = payload.subjects ?? [];
    expect(subjects).toHaveLength(1);
    expect(subjects[0]).toMatchObject({ kind: "catalog.system" });
  });
});
