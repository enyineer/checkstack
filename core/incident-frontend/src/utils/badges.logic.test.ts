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
  const cases: Array<[IncidentStatus, string]> = [
    ["investigating", "Investigating"],
    ["identified", "Identified"],
    ["fixing", "Fixing"],
    ["monitoring", "Monitoring"],
    ["resolved", "Resolved"],
  ];

  test.each(cases)("maps %s to the label %s", (status, label) => {
    expect(presentIncidentStatus(status)).toEqual({ label });
  });

  test("carries NO tone: severity owns the row's hue", () => {
    // An incident shows severity AND status; colouring both puts two competing
    // scales on one line (a red "Investigating" beside an amber "Major" reads
    // as a contradiction). A tone returned here would be unused weight that
    // invites re-colouring the status later.
    for (const [status] of cases) {
      expect(presentIncidentStatus(status)).not.toHaveProperty("tone");
    }
  });
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
