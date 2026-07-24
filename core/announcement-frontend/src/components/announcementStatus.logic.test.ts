import { describe, expect, test } from "bun:test";
import { pillToneStyles as toneStyles } from "@checkstack/ui";
import {
  getAnnouncementStatus,
  severityToTone,
  statusToTone,
  tallyStatuses,
  STATUS_BUCKETS,
  announcementSeverityRank,
  announcementStatusRank,
} from "./announcementStatus.logic";

const NOW = new Date("2026-06-20T12:00:00Z");
const PAST = new Date("2026-06-19T12:00:00Z");
const FUTURE = new Date("2026-06-21T12:00:00Z");

describe("getAnnouncementStatus", () => {
  test("inactive when active flag is false, regardless of window", () => {
    expect(
      getAnnouncementStatus(
        { active: false, startsAt: null, expiresAt: null },
        NOW,
      ),
    ).toBe("inactive");
    expect(
      getAnnouncementStatus(
        { active: false, startsAt: FUTURE, expiresAt: PAST },
        NOW,
      ),
    ).toBe("inactive");
  });

  test("scheduled when startsAt is in the future", () => {
    expect(
      getAnnouncementStatus(
        { active: true, startsAt: FUTURE, expiresAt: null },
        NOW,
      ),
    ).toBe("scheduled");
  });

  test("expired when expiresAt is at or before now", () => {
    expect(
      getAnnouncementStatus(
        { active: true, startsAt: null, expiresAt: PAST },
        NOW,
      ),
    ).toBe("expired");
    expect(
      getAnnouncementStatus(
        { active: true, startsAt: null, expiresAt: NOW },
        NOW,
      ),
    ).toBe("expired");
  });

  test("scheduled takes precedence over expired", () => {
    expect(
      getAnnouncementStatus(
        { active: true, startsAt: FUTURE, expiresAt: PAST },
        NOW,
      ),
    ).toBe("scheduled");
  });

  test("active when within window or no window", () => {
    expect(
      getAnnouncementStatus(
        { active: true, startsAt: null, expiresAt: null },
        NOW,
      ),
    ).toBe("active");
    expect(
      getAnnouncementStatus(
        { active: true, startsAt: PAST, expiresAt: FUTURE },
        NOW,
      ),
    ).toBe("active");
  });
});

describe("statusToTone", () => {
  test("active is the live state", () => {
    expect(statusToTone("active")).toBe("ok");
  });

  test("scheduled is informational blue, not grey and not amber", () => {
    // Regression: scheduled fell through a `default:` arm to the grey `unknown`
    // tone, so "waiting for its start date" was indistinguishable from "inert".
    // It is deliberately NOT `warn` either - amber means "degraded / needs
    // attention" product-wide, and a correctly scheduled announcement is fine.
    expect(statusToTone("scheduled")).toBe("info");
  });

  test("expired and inactive are the inert grey", () => {
    // Grey is the DESIGNED tone for inert states, so these two keep it - but now
    // by explicit decision rather than by falling through a default arm. They
    // share a hue and are told apart by their labels, never by colour alone.
    expect(statusToTone("expired")).toBe("unknown");
    expect(statusToTone("inactive")).toBe("unknown");
  });

  test("every bucket in the stat strip resolves to a defined tone", () => {
    for (const { status } of STATUS_BUCKETS) {
      const styles = toneStyles[statusToTone(status)];
      expect(styles.accent).toContain(`status-${statusToTone(status)}`);
    }
  });
});

describe("severityToTone", () => {
  test("maps severities onto the status tones", () => {
    expect(severityToTone("critical")).toBe("down");
    expect(severityToTone("warning")).toBe("warn");
  });

  test("info maps to the blue info tone, never the grey unknown tone", () => {
    // Regression: info severity fell through to `unknown`, so the pill, the
    // card accent stripe and the banner all rendered grey (`*-status-unknown`)
    // instead of the informational blue hue.
    expect(severityToTone("info")).toBe("info");
  });

  test("every severity resolves to a tone that has classes defined", () => {
    for (const severity of ["critical", "warning", "info"] as const) {
      const styles = toneStyles[severityToTone(severity)];
      expect(styles.pill).toContain(`status-${severityToTone(severity)}`);
      expect(styles.dot).toContain(`status-${severityToTone(severity)}`);
      expect(styles.accent).toContain(`status-${severityToTone(severity)}`);
      expect(styles.text).toContain(`status-${severityToTone(severity)}`);
    }
  });
});

describe("sort ranks", () => {
  test("severity sorts by impact, not alphabetically", () => {
    const byRank = (["info", "warning", "critical"] as const)
      .toSorted((a, b) => announcementSeverityRank[a] - announcementSeverityRank[b]);
    expect(byRank).toEqual(["critical", "warning", "info"]);
  });

  test("status sorts by lifecycle, matching the stat strip's bucket order", () => {
    const byRank = (["inactive", "expired", "scheduled", "active"] as const)
      .toSorted((a, b) => announcementStatusRank[a] - announcementStatusRank[b]);
    expect(byRank).toEqual(STATUS_BUCKETS.map((b) => b.status));
  });

  test("every status and severity has a rank (no undefined sort key)", () => {
    for (const { status } of STATUS_BUCKETS) {
      expect(announcementStatusRank[status]).toBeNumber();
    }
    for (const severity of ["info", "warning", "critical"] as const) {
      expect(announcementSeverityRank[severity]).toBeNumber();
    }
  });
});

describe("tallyStatuses", () => {
  test("returns every bucket even when empty", () => {
    expect(tallyStatuses([], NOW)).toEqual({
      active: 0,
      scheduled: 0,
      expired: 0,
      inactive: 0,
    });
  });

  test("counts each announcement into its bucket", () => {
    const counts = tallyStatuses(
      [
        { active: true, startsAt: null, expiresAt: null },
        { active: true, startsAt: PAST, expiresAt: FUTURE },
        { active: true, startsAt: FUTURE, expiresAt: null },
        { active: true, startsAt: null, expiresAt: PAST },
        { active: false, startsAt: null, expiresAt: null },
      ],
      NOW,
    );
    expect(counts).toEqual({
      active: 2,
      scheduled: 1,
      expired: 1,
      inactive: 1,
    });
  });
});
