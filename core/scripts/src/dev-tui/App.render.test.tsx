import { describe, expect, it } from "bun:test";
import React from "react";
import { renderToString } from "ink";
import { App } from "./App.tsx";
import { createFakeSupervisor } from "./fake-supervisor.ts";
import { computeLayout } from "./layout.ts";
import type { ScrollbackLine } from "./scrollback.ts";

const ALERTS_CAPACITY = 8;

/** Strip ANSI SGR sequences so we can measure printable width and content. */
function stripAnsi(value: string): string {
  // Build the ESC (0x1b) prefix without a literal control char in the source,
  // so we avoid both a control-char regex and any lint suppression.
  const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
  return value.replace(ansiPattern, "");
}

/**
 * Seed the focused (backend) pane with MANY lines that are each LONGER than the
 * terminal width, so the only way the frame can stay within bounds is the
 * height clamp plus per-line truncation working together.
 */
function manyLongLines(count: number, columns: number): ScrollbackLine[] {
  const lines: ScrollbackLine[] = [];
  for (let index = 0; index < count; index += 1) {
    lines.push({
      level: "info",
      text: `line-${index}-`.padEnd(columns * 2, "x"),
    });
  }
  return lines;
}

describe("App height clamp (DOM-free render test)", () => {
  const columns = 80;
  // More lines than any tested terminal is tall, each wider than `columns`.
  const seededLineCount = 200;

  for (const rows of [24, 40]) {
    it(`never overflows ${rows} rows when the focused pane floods output`, () => {
      const supervisor = createFakeSupervisor();
      const frame = renderToString(
        <App
          supervisor={supervisor}
          size={{ rows, columns }}
          initialFocused="backend"
          preloadLines={{ backend: manyLongLines(seededLineCount, columns) }}
        />,
        { columns },
      );

      const lines = frame.split("\n");

      // 1. The frame must never be taller than the terminal. This is the hard
      //    invariant the clamp guarantees.
      expect(lines.length).toBeLessThanOrEqual(rows);

      // 2. The clamp fills the terminal exactly (no overflow, no wasted band).
      expect(lines.length).toBe(rows);

      // 3. The pinned chrome must still be on-screen (not pushed off the bottom).
      const plain = stripAnsi(frame);
      expect(plain).toContain("quit");
      expect(plain).toContain("alerts");

      // 4. Per-line truncation holds: no rendered row exceeds the width.
      for (const line of lines) {
        expect(stripAnsi(line).length).toBeLessThanOrEqual(columns);
      }

      // 5. The focused pane shows EXACTLY the computed log-row budget worth of
      //    seeded lines. The seeded lines start with "line-<n>-", so counting
      //    those rows tells us how many log rows actually rendered. The pre-fix
      //    `rows - 16` reserve under-filled this (e.g. 8 rows at rows=24 instead
      //    of the correct 15), so this assertion discriminates the fix.
      const expectedLogRows = computeLayout({
        size: { rows, columns },
        alertCount: 0,
        alertCapacity: ALERTS_CAPACITY,
      }).logRows;
      const logRowsRendered = lines.filter((line) =>
        stripAnsi(line).includes("line-"),
      ).length;
      expect(logRowsRendered).toBe(expectedLogRows);
    });
  }

  it("keeps the footer and alerts visible when alerts fill to capacity and logs flood", () => {
    const supervisor = createFakeSupervisor();
    const seededAlerts = Array.from({ length: 8 }, (_, index) => ({
      source: "backend" as const,
      level: "error" as const,
      text: `alert-${index}-`.padEnd(columns * 2, "y"),
      seq: index,
    }));
    const frame = renderToString(
      <App
        supervisor={supervisor}
        size={{ rows: 24, columns }}
        initialFocused="backend"
        preloadLines={{ backend: manyLongLines(seededLineCount, columns) }}
        initialAlerts={seededAlerts}
      />,
      { columns },
    );
    const lines = frame.split("\n");
    expect(lines.length).toBeLessThanOrEqual(24);
    const plain = stripAnsi(frame);
    expect(plain).toContain("quit");
    expect(plain).toContain("alerts (8)");
    for (const line of lines) {
      expect(stripAnsi(line).length).toBeLessThanOrEqual(columns);
    }
  });

  it("renders the seeded flood as the visible content of the focused pane", () => {
    const supervisor = createFakeSupervisor();
    const frame = renderToString(
      <App
        supervisor={supervisor}
        size={{ rows: 24, columns }}
        initialFocused="backend"
        preloadLines={{ backend: manyLongLines(seededLineCount, columns) }}
      />,
      { columns },
    );
    // The seam actually seeds the focused pane: at least one of the flooded
    // backend lines is visible (so the clamp is being exercised against real
    // content, not an empty placeholder).
    const plain = stripAnsi(frame);
    expect(plain).toContain("line-");
    expect(plain).not.toContain("Waiting for output...");
  });
});
