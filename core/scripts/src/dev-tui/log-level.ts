import { stripAnsi } from "./text.ts";

/**
 * Normalized log level used across the dev runner UI. The dev processes emit
 * several formats (winston for the backend, vite/bun for the frontend), so we
 * collapse every variant into these four buckets for coloring and alerting.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Map a raw level token (any case, any source format) to a normalized level.
 * Winston's lower tiers (verbose/silly/http) collapse to "debug"; "warning"
 * collapses to "warn"; "fatal" / "err" collapse to "error".
 */
function normalizeToken(token: string): LogLevel | undefined {
  switch (token.toLowerCase()) {
    case "error":
    case "err":
    case "fatal": {
      return "error";
    }
    case "warn":
    case "warning": {
      return "warn";
    }
    case "info":
    case "log":
    case "notice": {
      return "info";
    }
    case "debug":
    case "verbose":
    case "silly":
    case "http":
    case "trace": {
      return "debug";
    }
    default: {
      return undefined;
    }
  }
}

// `21:02:49 info: ...` (winston dev format) - optional timestamp, then a level
// token, then a colon. The level word is matched as a whole token.
const WINSTON_FORMAT =
  /^(?:\d{2}:\d{2}:\d{2}\s+)?([A-Za-z]+):\s/;

// Bracketed level tag, e.g. `[ERROR]`, `VITE  [warning]`.
const BRACKET_FORMAT = /\[([A-Za-z]+)\]/;

// Leading capitalized `Error:` that vite/node print for thrown errors.
const LEADING_ERROR = /^(?:uncaught\s+)?error\b/i;

export interface DetectLogLevelInput {
  /** A single raw output line (may still contain ANSI color codes). */
  line: string;
}

/**
 * Classify a single raw output line into a normalized {@link LogLevel}.
 *
 * Strategy (first match wins):
 *  1. Winston dev format `HH:mm:ss <level>:` or a bare `<level>:` prefix.
 *  2. A bracketed `[LEVEL]` tag anywhere in the line.
 *  3. A leading `Error:` (vite/node thrown errors).
 *  4. Fallback to "info" so ordinary stdout stays readable.
 */
export function detectLogLevel({ line }: DetectLogLevelInput): LogLevel {
  const plain = stripAnsi(line).trim();
  if (plain.length === 0) {
    return "info";
  }

  const winstonMatch = WINSTON_FORMAT.exec(plain);
  if (winstonMatch) {
    const level = normalizeToken(winstonMatch[1] ?? "");
    if (level) {
      return level;
    }
  }

  const bracketMatch = BRACKET_FORMAT.exec(plain);
  if (bracketMatch) {
    const level = normalizeToken(bracketMatch[1] ?? "");
    if (level) {
      return level;
    }
  }

  if (LEADING_ERROR.test(plain)) {
    return "error";
  }

  return "info";
}

/**
 * Whether a level should surface in the pinned Alerts panel. Only warnings and
 * errors are aggregated so the panel stays signal, not noise.
 */
export function isAlertLevel(level: LogLevel): boolean {
  return level === "warn" || level === "error";
}
