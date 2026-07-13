/**
 * Severity banding helpers. Log sources speak three different severity
 * dialects - OTel `severityNumber` (1-24), free-text level names, and syslog
 * PRI severities (0-7) - and the platform folds all of them into six ordered
 * bands so aggregates, assertions and charts share one vocabulary.
 *
 * Pure module: no IO, exhaustively unit-tested. Ingest normalizers call these
 * to derive a stream's `band` (for the severity buckets) and a canonical
 * `severityNumber` (for the raw `log_events` row).
 */

/** The six ordered severity bands, weakest to strongest. */
export const SEVERITY_BANDS = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
] as const;

export type SeverityBand = (typeof SEVERITY_BANDS)[number];

/**
 * Comparable rank for a band (0 = trace .. 5 = fatal). Use to pick the worst of
 * two bands or to threshold ("band >= warn").
 */
export const SEVERITY_BAND_RANK: Record<SeverityBand, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  fatal: 5,
};

/**
 * A representative OTel `severityNumber` for a band (the band's midpoint). Used
 * when a source gives only a level name / syslog severity but the raw row still
 * needs a numeric `severityNumber`.
 */
export const SEVERITY_NUMBER_FOR_BAND: Record<SeverityBand, number> = {
  trace: 2,
  debug: 6,
  info: 9,
  warn: 14,
  error: 18,
  fatal: 22,
};

/** Return the worse (higher-rank) of two bands. */
export function worstBand({
  a,
  b,
}: {
  a: SeverityBand;
  b: SeverityBand;
}): SeverityBand {
  return SEVERITY_BAND_RANK[a] >= SEVERITY_BAND_RANK[b] ? a : b;
}

/**
 * Map an OTel `severityNumber` to a band. Bands follow the OTel spec ranges:
 * 1-4 TRACE, 5-8 DEBUG, 9-12 INFO, 13-16 WARN, 17-20 ERROR, 21-24 FATAL.
 * `0` (UNSPECIFIED) and any out-of-range / non-finite value default to `info`.
 */
export function bandFromSeverityNumber(severityNumber: number): SeverityBand {
  if (!Number.isFinite(severityNumber)) return "info";
  const n = Math.trunc(severityNumber);
  if (n >= 1 && n <= 4) return "trace";
  if (n >= 5 && n <= 8) return "debug";
  if (n >= 9 && n <= 12) return "info";
  if (n >= 13 && n <= 16) return "warn";
  if (n >= 17 && n <= 20) return "error";
  if (n >= 21 && n <= 24) return "fatal";
  return "info";
}

/**
 * Map a free-text level name (`"ERROR"`, `"warning"`, `"trace"`, syslog words
 * like `"emerg"`/`"notice"`, common aliases like `"err"`/`"crit"`/`"panic"`)
 * to a band. Case-insensitive and whitespace-trimmed. An unrecognized or empty
 * name yields `null` so the caller can fall back to a numeric severity.
 */
export function bandFromLevelName(level: string): SeverityBand | null {
  const key = level.trim().toLowerCase();
  if (key.length === 0) return null;
  return LEVEL_NAME_BANDS[key] ?? null;
}

const LEVEL_NAME_BANDS: Record<string, SeverityBand> = {
  // trace
  trace: "trace",
  // debug
  debug: "debug",
  dbg: "debug",
  fine: "debug",
  finer: "debug",
  finest: "trace",
  verbose: "trace",
  // info
  info: "info",
  information: "info",
  informational: "info",
  notice: "info",
  log: "info",
  // warn
  warn: "warn",
  warning: "warn",
  // error
  error: "error",
  err: "error",
  severe: "error",
  // fatal
  fatal: "fatal",
  crit: "fatal",
  critical: "fatal",
  alert: "fatal",
  emerg: "fatal",
  emergency: "fatal",
  panic: "fatal",
};

/**
 * Map a syslog severity code (RFC 5424, 0-7) to a band:
 * 0-2 (emergency/alert/critical) -> fatal, 3 (error) -> error,
 * 4 (warning) -> warn, 5-6 (notice/info) -> info, 7 (debug) -> debug.
 * Out-of-range values default to `info`.
 */
export function bandFromSyslogSeverity(severity: number): SeverityBand {
  const n = Math.trunc(severity);
  if (n >= 0 && n <= 2) return "fatal";
  if (n === 3) return "error";
  if (n === 4) return "warn";
  if (n === 5 || n === 6) return "info";
  if (n === 7) return "debug";
  return "info";
}

/**
 * Map a syslog PRI value (facility * 8 + severity) to a band by extracting the
 * low 3 bits as the severity. Defaults to `info` for a non-finite PRI.
 */
export function bandFromSyslogPri(pri: number): SeverityBand {
  if (!Number.isFinite(pri)) return "info";
  return bandFromSyslogSeverity(Math.trunc(pri) % 8);
}

/**
 * The eight RFC 5424 severity keywords, indexed by severity code (0-7):
 * 0 emerg, 1 alert, 2 crit, 3 err, 4 warning, 5 notice, 6 info, 7 debug.
 */
export const SYSLOG_SEVERITY_NAMES = [
  "emerg",
  "alert",
  "crit",
  "err",
  "warning",
  "notice",
  "info",
  "debug",
] as const;

/**
 * Map a syslog PRI value to its RFC 5424 severity KEYWORD (the low 3 bits, e.g.
 * PRI 11 -> severity 3 -> `"err"`). This keyword is the stable, source-native
 * value a stream's `severityRules.valueMap` keys on for syslog (native/OTLP key
 * on their own `level`/`severityText`), so `{ "err": "fatal" }` re-bands every
 * syslog error line. Defaults to `"info"` for a non-finite PRI (matching
 * {@link bandFromSyslogPri}).
 */
export function syslogSeverityName(pri: number): string {
  if (!Number.isFinite(pri)) return "info";
  return SYSLOG_SEVERITY_NAMES[Math.trunc(pri) % 8] ?? "info";
}
