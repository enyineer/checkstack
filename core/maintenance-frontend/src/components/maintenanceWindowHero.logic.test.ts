import { describe, expect, it } from "bun:test";
import { deriveWindowHero } from "./MaintenanceWindowHero";

const start = "2026-06-20T10:00:00.000Z";
const end = "2026-06-20T12:00:00.000Z";

describe("deriveWindowHero", () => {
  it("shows window length for scheduled windows", () => {
    const hero = deriveWindowHero({
      startAt: start,
      endAt: end,
      status: "scheduled",
      now: Date.now(),
    });
    expect(hero).toEqual({ figure: "2h", caption: "window length" });
  });

  it("shows window length for completed windows", () => {
    const hero = deriveWindowHero({
      startAt: start,
      endAt: end,
      status: "completed",
      now: Date.now(),
    });
    expect(hero.caption).toBe("window length");
    expect(hero.figure).toBe("2h");
  });

  it("shows live remaining time while in progress", () => {
    const now = new Date("2026-06-20T11:30:00.000Z").getTime();
    const hero = deriveWindowHero({
      startAt: start,
      endAt: end,
      status: "in_progress",
      now,
    });
    expect(hero).toEqual({ figure: "30m", caption: "time remaining" });
  });

  it("clamps remaining time to zero when the window has elapsed", () => {
    const now = new Date("2026-06-20T13:00:00.000Z").getTime();
    const hero = deriveWindowHero({
      startAt: start,
      endAt: end,
      status: "in_progress",
      now,
    });
    expect(hero).toEqual({ figure: "0m", caption: "time remaining" });
  });
});
