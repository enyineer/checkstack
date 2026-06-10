import { describe, test, expect } from "bun:test";
import {
  toPublicUpdate,
  toPublicIncident,
  toPublicMaintenance,
} from "./public-dto.logic";

describe("toPublicUpdate", () => {
  test("strips author identity (createdBy/createdByName)", () => {
    const out = toPublicUpdate({
      message: "We are investigating.",
      statusChange: "investigating",
      createdAt: "2026-06-10T12:00:00.000Z",
      createdBy: "user-123",
      createdByName: "Jane Operator",
    });
    expect(out).toEqual({
      message: "We are investigating.",
      statusChange: "investigating",
      at: "2026-06-10T12:00:00.000Z",
    });
    expect(out).not.toHaveProperty("createdBy");
    expect(out).not.toHaveProperty("createdByName");
  });

  test("omits absent statusChange and ISO-normalizes a Date", () => {
    const out = toPublicUpdate({
      message: "Update",
      createdAt: new Date("2026-06-10T12:00:00.000Z"),
    });
    expect(out).toEqual({ message: "Update", at: "2026-06-10T12:00:00.000Z" });
  });
});

describe("toPublicIncident", () => {
  const labels = new Map([
    ["sys-1", "API"],
    ["sys-2", "Web"],
  ]);

  test("maps to the allow-listed shape, labels systems, strips update authors", () => {
    const out = toPublicIncident({
      incident: {
        id: "inc-1",
        title: "API errors",
        status: "investigating",
        severity: "major",
        systemIds: ["sys-1", "sys-unknown"],
        createdAt: "2026-06-10T10:00:00.000Z",
        description: "internal note",
        updates: [
          {
            message: "Investigating",
            createdAt: "2026-06-10T10:05:00.000Z",
            createdBy: "user-9",
          },
        ],
      },
      systemLabels: labels,
    });
    expect(out.systems).toEqual(["API"]); // unknown id dropped
    expect(out.updates[0]).toEqual({
      message: "Investigating",
      at: "2026-06-10T10:05:00.000Z",
    });
    // No internal fields leaked.
    expect(out).not.toHaveProperty("description");
    expect(JSON.stringify(out)).not.toContain("user-9");
  });
});

describe("toPublicMaintenance", () => {
  test("maps to the allow-listed shape and strips update authors", () => {
    const out = toPublicMaintenance({
      maintenance: {
        id: "m-1",
        title: "DB upgrade",
        status: "scheduled",
        startAt: new Date("2026-06-12T22:00:00.000Z"),
        endAt: new Date("2026-06-12T23:00:00.000Z"),
        systemIds: ["sys-1"],
        updates: [
          {
            message: "Scheduled",
            createdAt: "2026-06-10T09:00:00.000Z",
            createdByName: "Ops",
          },
        ],
      },
      systemLabels: new Map([["sys-1", "Database"]]),
    });
    expect(out.systems).toEqual(["Database"]);
    expect(out.startAt).toBe("2026-06-12T22:00:00.000Z");
    expect(JSON.stringify(out)).not.toContain("Ops");
  });
});
