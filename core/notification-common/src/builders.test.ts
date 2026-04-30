import { describe, it, expect } from "bun:test";
import {
  createSubjectKindBuilder,
  createCollapseKeyBuilder,
} from "./builders";
import { NotificationSubjectSchema } from "./schemas";

describe("createSubjectKindBuilder", () => {
  const pluginMetadata = { pluginId: "catalog" };
  const createSystemSubject = createSubjectKindBuilder(
    pluginMetadata,
    "system",
  );

  it("namespaces the kind as '<pluginId>.<localKind>'", () => {
    const subject = createSystemSubject({ id: "sys-1", name: "Test" });
    expect(subject.kind).toBe("catalog.system");
  });

  it("preserves all entity fields", () => {
    const subject = createSystemSubject({
      id: "sys-1",
      name: "Test",
      url: "/systems/sys-1",
      status: "unhealthy",
    });
    expect(subject).toEqual({
      kind: "catalog.system",
      id: "sys-1",
      name: "Test",
      url: "/systems/sys-1",
      status: "unhealthy",
    });
  });

  it("produces values that pass NotificationSubjectSchema validation", () => {
    const subject = createSystemSubject({ id: "sys-1", name: "Test" });
    expect(() => NotificationSubjectSchema.parse(subject)).not.toThrow();
  });

  it("each builder is independent across plugins and local kinds", () => {
    const incidentSubject = createSubjectKindBuilder(
      { pluginId: "incident" },
      "incident",
    )({ id: "inc-1", name: "Outage" });
    const groupSubject = createSubjectKindBuilder(
      pluginMetadata,
      "group",
    )({ id: "grp-1", name: "Team" });

    expect(incidentSubject.kind).toBe("incident.incident");
    expect(groupSubject.kind).toBe("catalog.group");
  });
});

describe("createCollapseKeyBuilder", () => {
  const pluginMetadata = { pluginId: "incident" };
  const incidentCollapseKey = createCollapseKeyBuilder(
    pluginMetadata,
    "incident",
  );

  it("returns '<pluginId>.<localKind>.<entityId>' for single ids", () => {
    expect(incidentCollapseKey("inc-1")).toBe("incident.incident.inc-1");
  });

  it("joins multiple id components with dots", () => {
    const anomalyKey = createCollapseKeyBuilder(
      { pluginId: "anomaly" },
      "anomaly",
    );
    expect(anomalyKey("sys-1", "cpu.usage")).toBe(
      "anomaly.anomaly.sys-1.cpu.usage",
    );
  });

  it("uses the same prefix for every call", () => {
    const a = incidentCollapseKey("inc-1");
    const b = incidentCollapseKey("inc-2");
    expect(a.split(".").slice(0, 2)).toEqual(b.split(".").slice(0, 2));
  });
});
