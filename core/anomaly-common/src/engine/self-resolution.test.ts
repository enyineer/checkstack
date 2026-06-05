import { describe, test, expect } from "bun:test";
import {
  STABLE_RESOLUTION_RUN_COUNT,
  STABLE_RESOLUTION_RELATIVE_BAND,
  SUPPRESSION_REACTIVATION_DELTA,
  hasSettledAtNewLevel,
  appendRecentSample,
  isDriftFlatRelative,
  hasChangedSinceSuppression,
} from "./self-resolution";

describe("hasSettledAtNewLevel", () => {
  test("false when fewer than the required number of samples", () => {
    const window = Array.from(
      { length: STABLE_RESOLUTION_RUN_COUNT - 1 },
      () => 500,
    );
    expect(hasSettledAtNewLevel(window)).toBe(false);
  });

  test("true when enough samples sit inside the tight relative band", () => {
    // All within 10% of mean 500 → settled at a new level.
    const window = [500, 505, 498, 502, 500];
    expect(window.length).toBe(STABLE_RESOLUTION_RUN_COUNT);
    expect(hasSettledAtNewLevel(window)).toBe(true);
  });

  test("false when samples are still spread wider than the band", () => {
    // (max-min)/mean = (700-300)/500 = 0.8 ≫ band
    const window = [300, 700, 400, 600, 500];
    expect(hasSettledAtNewLevel(window)).toBe(false);
  });

  test("only considers the most recent STABLE_RESOLUTION_RUN_COUNT samples", () => {
    // Old volatile prefix, recent settled suffix.
    const window = [10, 9000, 500, 502, 498, 500, 501];
    expect(hasSettledAtNewLevel(window)).toBe(true);
  });

  test("band boundary is inclusive", () => {
    // spread exactly at the band edge relative to mean
    const mean = 100;
    const spread = STABLE_RESOLUTION_RELATIVE_BAND * mean; // 10
    const window = [mean - spread / 2, mean, mean, mean, mean + spread / 2];
    expect(hasSettledAtNewLevel(window)).toBe(true);
  });
});

describe("appendRecentSample", () => {
  test("appends to an empty window", () => {
    expect(appendRecentSample(undefined, 5)).toEqual([5]);
  });

  test("caps the window at STABLE_RESOLUTION_RUN_COUNT, dropping oldest", () => {
    let window: number[] | undefined;
    for (let i = 0; i < STABLE_RESOLUTION_RUN_COUNT + 3; i++) {
      window = appendRecentSample(window, i);
    }
    expect(window).toHaveLength(STABLE_RESOLUTION_RUN_COUNT);
    // Last value pushed was N+2; window keeps the most recent N.
    expect(window?.at(-1)).toBe(STABLE_RESOLUTION_RUN_COUNT + 2);
    expect(window?.[0]).toBe(3);
  });
});

describe("isDriftFlatRelative", () => {
  test("true when projected change is small relative to mean", () => {
    expect(isDriftFlatRelative({ projectedChange: 5, mean: 1000 })).toBe(true);
  });

  test("false when projected change is large relative to mean", () => {
    expect(isDriftFlatRelative({ projectedChange: 500, mean: 1000 })).toBe(
      false,
    );
  });

  test("handles near-zero mean without dividing by zero", () => {
    expect(isDriftFlatRelative({ projectedChange: 0, mean: 0 })).toBe(true);
    expect(isDriftFlatRelative({ projectedChange: 1, mean: 0 })).toBe(false);
  });
});

describe("hasChangedSinceSuppression", () => {
  test("false when the value stays within the reactivation band", () => {
    // 10% move, band is 25%
    expect(
      hasChangedSinceSuppression({ observedValue: 110, suppressedValue: 100 }),
    ).toBe(false);
  });

  test("true when the value moves beyond the reactivation band", () => {
    const beyond = 100 * (1 + SUPPRESSION_REACTIVATION_DELTA) + 1;
    expect(
      hasChangedSinceSuppression({
        observedValue: beyond,
        suppressedValue: 100,
      }),
    ).toBe(true);
  });

  test("reacts to moves in either direction", () => {
    expect(
      hasChangedSinceSuppression({ observedValue: 50, suppressedValue: 100 }),
    ).toBe(true);
  });
});
