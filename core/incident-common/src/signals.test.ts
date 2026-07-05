import { describe, test, expect } from "bun:test";
import {
  INCIDENT_SIGNAL_SOURCE_ID,
  deriveIncidentSignals,
} from "./signals";
import { incidentAccess } from "./access";
import type { IncidentWithSystems } from "./schemas";

const baseIncident = (
  overrides: Partial<IncidentWithSystems>,
): IncidentWithSystems => ({
  id: "inc-1",
  title: "Database down",
  description: undefined,
  status: "investigating",
  severity: "critical",
  suppressNotifications: false,
  healthOverride: null,
  createdAt: new Date("2026-06-01T10:00:00.000Z"),
  updatedAt: new Date("2026-06-01T10:00:00.000Z"),
  systemIds: ["sys-1"],
  ...overrides,
});

describe("deriveIncidentSignals", () => {
  test("emits one error signal per open critical incident, keyed by system", () => {
    const result = deriveIncidentSignals({
      incidentsBySystem: {
        "sys-1": [baseIncident({ id: "inc-1", severity: "critical" })],
      },
      systemIds: ["sys-1"],
    });

    expect(result["sys-1"]).toHaveLength(1);
    expect(result["sys-1"][0]).toEqual({
      source: INCIDENT_SIGNAL_SOURCE_ID,
      tone: "error",
      label: "Critical incident",
      detail: "Database down",
      href: "/incident/inc-1",
      accessRule: incidentAccess.incident.read,
      since: "2026-06-01T10:00:00.000Z",
      iconName: "TriangleAlert",
    });
  });

  test("maps severity to tone/label (major->warn, minor->info)", () => {
    const result = deriveIncidentSignals({
      incidentsBySystem: {
        "sys-1": [
          baseIncident({ id: "inc-major", severity: "major", title: "Slow" }),
        ],
        "sys-2": [
          baseIncident({
            id: "inc-minor",
            severity: "minor",
            title: "Cosmetic",
            systemIds: ["sys-2"],
          }),
        ],
      },
      systemIds: ["sys-1", "sys-2"],
    });

    expect(result["sys-1"][0].tone).toBe("warn");
    expect(result["sys-1"][0].label).toBe("Major incident");
    expect(result["sys-2"][0].tone).toBe("info");
    expect(result["sys-2"][0].label).toBe("Incident");
  });

  test("skips resolved incidents and systems with no open problem", () => {
    const result = deriveIncidentSignals({
      incidentsBySystem: {
        "sys-1": [baseIncident({ id: "inc-1", status: "resolved" })],
        "sys-2": [],
      },
      systemIds: ["sys-1", "sys-2", "sys-3"],
    });

    expect(result).toEqual({});
  });

  test("emits multiple signals for a system with multiple open incidents", () => {
    const result = deriveIncidentSignals({
      incidentsBySystem: {
        "sys-1": [
          baseIncident({ id: "inc-1", severity: "critical" }),
          baseIncident({ id: "inc-2", severity: "minor", title: "Other" }),
        ],
      },
      systemIds: ["sys-1"],
    });

    expect(result["sys-1"]).toHaveLength(2);
    expect(result["sys-1"][0].tone).toBe("error");
    expect(result["sys-1"][1].tone).toBe("info");
  });
});
