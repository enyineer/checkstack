import { describe, expect, test } from "bun:test";
import type {
  IncidentSeverity,
  IncidentStatus,
} from "@checkstack/incident-common";
import {
  getIncidentSeverityAccentClass,
  presentIncidentSeverity,
  presentIncidentStatus,
  type StatusTone,
} from "./badges.logic";

describe("presentIncidentStatus", () => {
  const cases: Array<[IncidentStatus, StatusTone, string]> = [
    ["investigating", "down", "Investigating"],
    ["identified", "warn", "Identified"],
    ["fixing", "warn", "Fixing"],
    ["monitoring", "info", "Monitoring"],
    ["resolved", "ok", "Resolved"],
  ];

  test.each(cases)(
    "maps %s to tone %s + label %s",
    (status, tone, label) => {
      expect(presentIncidentStatus(status)).toEqual({ tone, label });
    },
  );
});

describe("presentIncidentSeverity", () => {
  const cases: Array<[IncidentSeverity, StatusTone, string]> = [
    ["critical", "down", "Critical"],
    ["major", "warn", "Major"],
    ["minor", "info", "Minor"],
  ];

  test.each(cases)(
    "maps %s to tone %s + label %s",
    (severity, tone, label) => {
      expect(presentIncidentSeverity(severity)).toEqual({ tone, label });
    },
  );
});

describe("getIncidentSeverityAccentClass", () => {
  test("derives the accent class from the same triad tone as the badge", () => {
    expect(getIncidentSeverityAccentClass("critical")).toBe("bg-status-down");
    expect(getIncidentSeverityAccentClass("major")).toBe("bg-status-warn");
    expect(getIncidentSeverityAccentClass("minor")).toBe("bg-status-info");
  });
});
