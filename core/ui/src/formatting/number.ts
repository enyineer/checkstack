/**
 * Number, byte-size and percentage formatting helpers.
 *
 * Pure, locale-aware (via `Intl`, with an `undefined` locale) and free of any
 * React dependency.
 */

/** Options for {@link formatNumber}. */
export interface FormatNumberOptions {
  /** Minimum number of fraction digits. */
  minimumFractionDigits?: number;
  /** Maximum number of fraction digits. Defaults to `0` (integer display). */
  maximumFractionDigits?: number;
}

/**
 * Format a number with locale-aware thousands separators (e.g. `1234567` ->
 * "1,234,567" in en locales). Defaults to no fraction digits. Returns an empty
 * string for non-finite input (`NaN`, `Infinity`).
 */
export function formatNumber(value: number, opts: FormatNumberOptions = {}): string {
  if (!Number.isFinite(value)) return "";
  const { minimumFractionDigits, maximumFractionDigits = 0 } = opts;
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(value);
}

/** Options for {@link formatBytes}. */
export interface FormatBytesOptions {
  /**
   * Use binary (1024-based, KiB/MiB/GiB) units when `true` (the default), or
   * decimal (1000-based, kB/MB/GB) units when `false`.
   *
   * Default is BINARY because the cache runtime panel reports binary sizes.
   */
  binary?: boolean;
  /** Maximum fraction digits for the scaled value. Defaults to `1`. */
  fractionDigits?: number;
}

const BINARY_UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"] as const;
const DECIMAL_UNITS = ["B", "kB", "MB", "GB", "TB", "PB"] as const;

/**
 * Format a byte count as a human-readable size.
 *
 * Defaults to BINARY units (1024-based: B, KiB, MiB, GiB, ...). Pass
 * `{ binary: false }` for decimal units (1000-based: B, kB, MB, GB, ...).
 * Bytes (the base unit) are always rendered without fraction digits. Negative
 * values keep their sign. Returns an empty string for non-finite input.
 */
export function formatBytes(bytes: number, opts: FormatBytesOptions = {}): string {
  if (!Number.isFinite(bytes)) return "";
  const { binary = true, fractionDigits = 1 } = opts;
  const base = binary ? 1024 : 1000;
  const units = binary ? BINARY_UNITS : DECIMAL_UNITS;

  const sign = bytes < 0 ? "-" : "";
  let value = Math.abs(bytes);

  if (value < base) {
    return `${sign}${value} ${units[0]}`;
  }

  let unitIndex = 0;
  while (value >= base && unitIndex < units.length - 1) {
    value /= base;
    unitIndex += 1;
  }

  const formatted = value.toLocaleString(undefined, {
    maximumFractionDigits: fractionDigits,
  });
  return `${sign}${formatted} ${units[unitIndex]}`;
}

/** Options for {@link formatPercent}. */
export interface FormatPercentOptions {
  /**
   * Treat the input as an already-scaled percentage (0-100) instead of a
   * ratio (0-1). Defaults to `false`, i.e. the input is a 0-1 ratio.
   */
  alreadyPercent?: boolean;
  /** Number of fraction digits to render. Defaults to `0`. */
  fractionDigits?: number;
}

/**
 * Format a value as a percentage string (e.g. "42%").
 *
 * By default the input is interpreted as a 0-1 ratio (so `0.42` -> "42%").
 * Pass `{ alreadyPercent: true }` when the input is already on a 0-100 scale
 * (so `42` -> "42%"). Returns an empty string for non-finite input.
 */
export function formatPercent(value: number, opts: FormatPercentOptions = {}): string {
  if (!Number.isFinite(value)) return "";
  const { alreadyPercent = false, fractionDigits = 0 } = opts;
  const percent = alreadyPercent ? value : value * 100;
  const formatted = percent.toLocaleString(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
  return `${formatted}%`;
}
