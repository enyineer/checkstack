import { describe, expect, test } from "bun:test";

import { formatBytes, formatNumber, formatPercent } from "./number";

describe("formatNumber", () => {
  test("adds thousands separators for large numbers", () => {
    // Strip locale-specific grouping chars to assert digit grouping happened.
    const result = formatNumber(1234567);
    const digitsOnly = result.replace(/\D/g, "");
    expect(digitsOnly).toBe("1234567");
    // There must be a non-digit grouping separator somewhere.
    expect(result).not.toBe("1234567");
  });

  test("defaults to no fraction digits", () => {
    expect(formatNumber(1234.987).replace(/\D/g, "")).toBe("1235");
  });

  test("respects maximumFractionDigits", () => {
    const result = formatNumber(1.23456, { maximumFractionDigits: 2 });
    expect(result).toMatch(/^1\D?23$|^1.23$/);
  });

  test("formats zero", () => {
    expect(formatNumber(0)).toBe("0");
  });

  test("returns empty string for NaN", () => {
    expect(formatNumber(Number.NaN)).toBe("");
  });

  test("returns empty string for Infinity", () => {
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe("");
  });
});

describe("formatBytes", () => {
  test("formats 0 bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  test("formats sub-KiB values as bytes (no fraction)", () => {
    expect(formatBytes(512)).toBe("512 B");
  });

  test("defaults to binary (1024-based) units", () => {
    expect(formatBytes(1024)).toBe("1 KiB");
    expect(formatBytes(1024 * 1024)).toBe("1 MiB");
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1 GiB");
  });

  test("scales with one fraction digit by default", () => {
    expect(formatBytes(1536)).toBe("1.5 KiB");
  });

  test("supports decimal (1000-based) units via { binary: false }", () => {
    expect(formatBytes(1000, { binary: false })).toBe("1 kB");
    expect(formatBytes(1_000_000, { binary: false })).toBe("1 MB");
  });

  test("respects fractionDigits", () => {
    expect(formatBytes(1500, { binary: false, fractionDigits: 2 })).toBe("1.5 kB");
    expect(formatBytes(1126, { fractionDigits: 2 })).toBe("1.1 KiB");
  });

  test("handles very large values (TiB)", () => {
    expect(formatBytes(1024 ** 4)).toBe("1 TiB");
  });

  test("keeps the sign for negative byte counts", () => {
    expect(formatBytes(-1024)).toBe("-1 KiB");
    expect(formatBytes(-512)).toBe("-512 B");
  });

  test("returns empty string for non-finite input", () => {
    expect(formatBytes(Number.NaN)).toBe("");
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("");
  });
});

describe("formatPercent", () => {
  test("treats input as a 0-1 ratio by default", () => {
    expect(formatPercent(0.42)).toBe("42%");
    expect(formatPercent(1)).toBe("100%");
    expect(formatPercent(0)).toBe("0%");
  });

  test("treats input as already-scaled with { alreadyPercent: true }", () => {
    expect(formatPercent(42, { alreadyPercent: true })).toBe("42%");
  });

  test("respects fractionDigits", () => {
    expect(formatPercent(0.12345, { fractionDigits: 1 })).toBe("12.3%");
    expect(formatPercent(99.987, { alreadyPercent: true, fractionDigits: 2 })).toBe(
      "99.99%",
    );
  });

  test("returns empty string for non-finite input", () => {
    expect(formatPercent(Number.NaN)).toBe("");
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe("");
  });
});
