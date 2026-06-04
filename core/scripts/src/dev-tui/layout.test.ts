import { describe, expect, it } from "bun:test";
import { computeLayout } from "./layout.ts";

const ALERT_CAPACITY = 8;

describe("computeLayout", () => {
  it("fills the terminal exactly when it is tall enough", () => {
    const layout = computeLayout({
      size: { rows: 24, columns: 80 },
      alertCount: 0,
      alertCapacity: ALERT_CAPACITY,
    });
    // Chrome = status(1) + main panel(3) + alerts panel(3) + footer(1) = 8.
    // Content budget = 24 - 8 = 16, split as 1 alert row + 15 log rows.
    expect(layout.totalRows).toBe(24);
    expect(layout.logRows + layout.alertRows).toBe(16);
    expect(layout.alertRows).toBe(1);
    expect(layout.logRows).toBe(15);
  });

  it("never reports more rows than the terminal has, for any alert count", () => {
    for (const rows of [10, 18, 24, 40, 60]) {
      for (let alertCount = 0; alertCount <= ALERT_CAPACITY + 4; alertCount += 1) {
        const layout = computeLayout({
          size: { rows, columns: 80 },
          alertCount,
          alertCapacity: ALERT_CAPACITY,
        });
        expect(layout.totalRows).toBeLessThanOrEqual(rows);
        expect(layout.logRows).toBeGreaterThanOrEqual(1);
        expect(layout.alertRows).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("clamps the alerts list to the buffer capacity", () => {
    const layout = computeLayout({
      size: { rows: 60, columns: 80 },
      alertCount: 100,
      alertCapacity: ALERT_CAPACITY,
    });
    expect(layout.alertRows).toBe(ALERT_CAPACITY);
  });

  it("grows the alerts pane with the alert count up to capacity", () => {
    const three = computeLayout({
      size: { rows: 40, columns: 80 },
      alertCount: 3,
      alertCapacity: ALERT_CAPACITY,
    });
    expect(three.alertRows).toBe(3);
  });

  it("keeps at least one log and one alert row on a tiny terminal", () => {
    const layout = computeLayout({
      size: { rows: 4, columns: 80 },
      alertCount: 5,
      alertCapacity: ALERT_CAPACITY,
    });
    expect(layout.logRows).toBe(1);
    expect(layout.alertRows).toBe(1);
  });

  it("uses more of the terminal than the pre-fix constant-16 reserve did", () => {
    // The old code computed mainHeight = max(3, rows - 16) regardless of how
    // many alerts were queued, wasting up to 8 rows when alerts were sparse.
    // This locks in that the derived reserve never under-fills the terminal.
    for (const rows of [24, 40, 60]) {
      const oldMainHeight = Math.max(3, rows - 16);
      const layout = computeLayout({
        size: { rows, columns: 80 },
        alertCount: 0,
        alertCapacity: ALERT_CAPACITY,
      });
      expect(layout.logRows).toBeGreaterThan(oldMainHeight);
    }
  });

  it("protects the log pane minimum when alerts would otherwise consume the budget", () => {
    // rows=18 -> budget 10. With 8 alerts wanted, log must keep >= 1 row.
    const layout = computeLayout({
      size: { rows: 18, columns: 80 },
      alertCount: ALERT_CAPACITY,
      alertCapacity: ALERT_CAPACITY,
    });
    expect(layout.logRows).toBeGreaterThanOrEqual(1);
    expect(layout.totalRows).toBeLessThanOrEqual(18);
  });
});
