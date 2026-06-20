import { describe, expect, test } from "bun:test";
import {
  getAnnouncementStatus,
  severityToTone,
  statusToTone,
  tallyStatuses,
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
  test("active maps to ok, everything else to unknown", () => {
    expect(statusToTone("active")).toBe("ok");
    expect(statusToTone("scheduled")).toBe("unknown");
    expect(statusToTone("expired")).toBe("unknown");
    expect(statusToTone("inactive")).toBe("unknown");
  });
});

describe("severityToTone", () => {
  test("maps severities onto the triad", () => {
    expect(severityToTone("critical")).toBe("down");
    expect(severityToTone("warning")).toBe("warn");
    expect(severityToTone("info")).toBe("unknown");
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
