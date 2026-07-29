import { describe, expect, test } from "bun:test";
import {
  buildMaintenanceNotificationBody,
  formatMaintenanceWindow,
} from "./notification-body";

const WINDOW = {
  startAt: new Date("2026-08-01T22:00:00.000Z"),
  endAt: new Date("2026-08-02T02:30:00.000Z"),
};

describe("formatMaintenanceWindow", () => {
  test("renders both ends in UTC with an explicit zone", () => {
    // The zone suffix is not decoration: recipients span timezones and the
    // pipeline has no per-recipient zone, so an unlabelled time is unreadable.
    expect(formatMaintenanceWindow(WINDOW)).toBe(
      "2026-08-01 22:00 - 2026-08-02 02:30 UTC",
    );
  });

  test("accepts ISO strings (the wire form) as well as Dates", () => {
    expect(
      formatMaintenanceWindow({
        startAt: "2026-08-01T22:00:00.000Z",
        endAt: "2026-08-02T02:30:00.000Z",
      }),
    ).toBe("2026-08-01 22:00 - 2026-08-02 02:30 UTC");
  });

  test("omits the window when either end is missing", () => {
    expect(
      formatMaintenanceWindow({ startAt: WINDOW.startAt, endAt: undefined }),
    ).toBeUndefined();
    expect(
      formatMaintenanceWindow({ startAt: null, endAt: WINDOW.endAt }),
    ).toBeUndefined();
  });

  test("omits the window rather than throwing on an unparseable date", () => {
    // An Invalid Date's toISOString() throws, which would take down the whole
    // notification instead of dropping one line.
    expect(() =>
      formatMaintenanceWindow({ startAt: "not-a-date", endAt: WINDOW.endAt }),
    ).not.toThrow();
    expect(
      formatMaintenanceWindow({ startAt: "not-a-date", endAt: WINDOW.endAt }),
    ).toBeUndefined();
  });
});

describe("buildMaintenanceNotificationBody", () => {
  test("states what happened, when, and what is planned", () => {
    const body = buildMaintenanceNotificationBody({
      maintenanceTitle: "Database upgrade",
      actionText: "scheduled",
      description: "Upgrading Postgres to 17. Expect ~10 minutes of downtime.",
      ...WINDOW,
      updateMessageSuffix: "",
    });

    expect(body).toContain('Maintenance **"Database upgrade"** has been scheduled.');
    expect(body).toContain("**When:** 2026-08-01 22:00 - 2026-08-02 02:30 UTC");
    expect(body).toContain("Upgrading Postgres to 17");
  });

  test("degrades to the original one-liner when there is nothing extra", () => {
    // The pre-existing behaviour must survive for a maintenance with no
    // description and no usable window.
    const body = buildMaintenanceNotificationBody({
      maintenanceTitle: "Quick restart",
      actionText: "started",
      updateMessageSuffix: "",
    });

    expect(body).toBe('Maintenance **"Quick restart"** has been started.');
  });

  test("omits the description line when it is blank rather than leaving a gap", () => {
    const body = buildMaintenanceNotificationBody({
      maintenanceTitle: "Quick restart",
      actionText: "started",
      description: "   \n\n  ",
      updateMessageSuffix: "",
    });

    expect(body).toBe('Maintenance **"Quick restart"** has been started.');
  });

  test("treats a null description as absent", () => {
    const body = buildMaintenanceNotificationBody({
      maintenanceTitle: "Quick restart",
      actionText: "started",
      description: null,
      updateMessageSuffix: "",
    });

    expect(body).not.toContain("null");
  });

  test("preserves authored markdown in the description", () => {
    // Escaping here would show raw `[text](url)` source in an email - the exact
    // bug the shared sanitizer was written to avoid.
    const body = buildMaintenanceNotificationBody({
      maintenanceTitle: "Migration",
      actionText: "scheduled",
      description: "See the [runbook](https://example.com/runbook).",
      updateMessageSuffix: "",
    });

    expect(body).toContain("[runbook](https://example.com/runbook)");
  });

  test("strips control characters from the description", () => {
    // Escapes rather than literal bytes: a raw NUL/ESC in a source file is
    // invisible in a diff and gets mangled by tooling.
    const body = buildMaintenanceNotificationBody({
      maintenanceTitle: "Migration",
      actionText: "scheduled",
      description: "Danger\u0000zone\u001B[31m",
      updateMessageSuffix: "",
    });

    expect(body).toContain("Dangerzone[31m");
    expect(body).not.toContain("\u0000");
    expect(body).not.toContain("\u001B");
  });

  test("bounds a very long description", () => {
    const body = buildMaintenanceNotificationBody({
      maintenanceTitle: "Migration",
      actionText: "scheduled",
      description: "x".repeat(5000),
      updateMessageSuffix: "",
    });

    expect(body.length).toBeLessThan(1000);
    expect(body).toContain("...");
  });

  test("keeps the update-message suffix last", () => {
    const body = buildMaintenanceNotificationBody({
      maintenanceTitle: "Migration",
      actionText: "updated",
      description: "Planned work",
      ...WINDOW,
      updateMessageSuffix: "\n\nRunning 20 minutes late.",
    });

    expect(body.endsWith("Running 20 minutes late.")).toBe(true);
  });

  test("separates every block with a blank line so markdown renders it", () => {
    const body = buildMaintenanceNotificationBody({
      maintenanceTitle: "Migration",
      actionText: "scheduled",
      description: "Planned work",
      ...WINDOW,
      updateMessageSuffix: "",
    });

    // Single newlines are not paragraph breaks in markdown; without the blank
    // line the window and description would run together into one paragraph.
    expect(body.split("\n\n")).toHaveLength(3);
  });
});
