import { describe, expect, test } from "bun:test";
import { OFFLINE_THRESHOLD_MS } from "@checkstack/satellite-common";
import {
  DEFAULT_THRESHOLD_VALUE,
  formatDuration,
  fromSelectValue,
  OFFLINE_THRESHOLD_OPTIONS,
  optionsWithCurrent,
  toSelectValue,
} from "./offline-threshold.logic";

describe("formatDuration", () => {
  test("renders seconds, minutes and hours in the largest fitting unit", () => {
    expect(formatDuration(45_000)).toBe("45 seconds");
    expect(formatDuration(120_000)).toBe("2 minutes");
    expect(formatDuration(3_600_000)).toBe("1 hour");
    expect(formatDuration(86_400_000)).toBe("24 hours");
  });

  test("singularises a unit of one", () => {
    expect(formatDuration(60_000)).toBe("1 minute");
    expect(formatDuration(1000)).toBe("1 second");
  });
});

describe("OFFLINE_THRESHOLD_OPTIONS", () => {
  test("offers the platform default first, as a real choice", () => {
    expect(OFFLINE_THRESHOLD_OPTIONS[0].value).toBeNull();
    expect(OFFLINE_THRESHOLD_OPTIONS[0].label).toContain(
      formatDuration(OFFLINE_THRESHOLD_MS),
    );
  });

  test("covers the range the request asked for", () => {
    const minutes = OFFLINE_THRESHOLD_OPTIONS.map((o) => o.value);

    for (const ms of [
      2 * 60_000,
      5 * 60_000,
      10 * 60_000,
      15 * 60_000,
      30 * 60_000,
      60 * 60_000,
      2 * 3_600_000,
      6 * 3_600_000,
      12 * 3_600_000,
      24 * 3_600_000,
    ]) {
      expect(minutes).toContain(ms);
    }
  });
});

describe("toSelectValue / fromSelectValue", () => {
  test("an unset threshold maps to the default sentinel", () => {
    expect(toSelectValue({})).toBe(DEFAULT_THRESHOLD_VALUE);
    expect(toSelectValue({ offlineThresholdMs: null })).toBe(
      DEFAULT_THRESHOLD_VALUE,
    );
  });

  test("the default sentinel parses back to null, which CLEARS the override", () => {
    // null and undefined mean different things on the wire: null clears, and
    // undefined leaves untouched. Clearing must stay expressible.
    expect(fromSelectValue({ value: DEFAULT_THRESHOLD_VALUE })).toBeNull();
  });

  test("round-trips a concrete threshold", () => {
    const ms = 600_000;
    expect(fromSelectValue({ value: toSelectValue({ offlineThresholdMs: ms }) })).toBe(
      ms,
    );
  });
});

describe("optionsWithCurrent", () => {
  test("returns the presets untouched when the value is a preset", () => {
    expect(
      optionsWithCurrent({ offlineThresholdMs: 600_000 }),
    ).toHaveLength(OFFLINE_THRESHOLD_OPTIONS.length);
  });

  test("returns the presets untouched when there is no override", () => {
    expect(optionsWithCurrent({})).toHaveLength(
      OFFLINE_THRESHOLD_OPTIONS.length,
    );
  });

  test("surfaces a non-preset stored value rather than snapping to a preset", () => {
    // A value set via API or GitOps must round-trip. Snapping it to the nearest
    // preset would change the satellite's behaviour just because someone opened
    // the dialog.
    const options = optionsWithCurrent({ offlineThresholdMs: 7 * 60_000 });

    expect(options).toHaveLength(OFFLINE_THRESHOLD_OPTIONS.length + 1);
    expect(options.at(-1)).toEqual({
      value: 7 * 60_000,
      label: "7 minutes (custom)",
    });
  });
});
