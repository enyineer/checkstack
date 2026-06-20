import { describe, test, expect } from "bun:test";
import {
  presentImportance,
  inboxRowAccentTone,
  summarizeDeliveryAttempts,
  toneStyles,
} from "./notificationDisplay.logic";

describe("presentImportance", () => {
  test("maps critical to the down tone with its label", () => {
    expect(presentImportance({ importance: "critical" })).toEqual({
      label: "Critical",
      tone: "down",
    });
  });

  test("maps warning to the warn tone with its label", () => {
    expect(presentImportance({ importance: "warning" })).toEqual({
      label: "Warning",
      tone: "warn",
    });
  });

  test("maps info to the ok tone with its label", () => {
    expect(presentImportance({ importance: "info" })).toEqual({
      label: "Info",
      tone: "ok",
    });
  });
});

describe("inboxRowAccentTone", () => {
  test("unread rows keep their importance tone", () => {
    expect(
      inboxRowAccentTone({ importance: "critical", isRead: false }),
    ).toBe("down");
    expect(inboxRowAccentTone({ importance: "warning", isRead: false })).toBe(
      "warn",
    );
    expect(inboxRowAccentTone({ importance: "info", isRead: false })).toBe(
      "ok",
    );
  });

  test("read rows recede to neutral regardless of importance", () => {
    expect(inboxRowAccentTone({ importance: "critical", isRead: true })).toBe(
      "neutral",
    );
    expect(inboxRowAccentTone({ importance: "info", isRead: true })).toBe(
      "neutral",
    );
  });
});

describe("summarizeDeliveryAttempts", () => {
  test("counts successes and failures across the page", () => {
    expect(
      summarizeDeliveryAttempts({
        attempts: [
          { status: "success" },
          { status: "failure" },
          { status: "success" },
          { status: "failure" },
          { status: "failure" },
        ],
      }),
    ).toEqual({ successes: 2, failures: 3 });
  });

  test("returns zeroes for an empty page", () => {
    expect(summarizeDeliveryAttempts({ attempts: [] })).toEqual({
      successes: 0,
      failures: 0,
    });
  });
});

describe("toneStyles", () => {
  test("every tone provides pill, dot, and accent classes", () => {
    for (const tone of ["ok", "warn", "down", "neutral"] as const) {
      expect(toneStyles[tone].pill.length).toBeGreaterThan(0);
      expect(toneStyles[tone].dot.length).toBeGreaterThan(0);
      expect(toneStyles[tone].accent.length).toBeGreaterThan(0);
    }
  });
});
