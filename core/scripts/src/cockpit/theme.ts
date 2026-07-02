import type { LogLevel } from "../dev-tui/log-level.ts";
import type { ProcessStatus } from "../dev-tui/types.ts";

const LEVEL_COLORS: Record<LogLevel, string> = {
  error: "red",
  warn: "yellow",
  debug: "gray",
  info: "white",
};

const STATUS_COLORS: Record<ProcessStatus, string> = {
  ready: "green",
  starting: "yellow",
  errored: "red",
  stopped: "gray",
};

/** Terminal colour for a captured log line's level. */
export function levelColor(level: LogLevel): string {
  return LEVEL_COLORS[level] ?? "white";
}

/** Terminal colour for a process status dot. */
export function statusColor(status: ProcessStatus): string {
  return STATUS_COLORS[status] ?? "gray";
}

/** Cockpit accent colour used for headers / active items. */
export const ACCENT = "cyan";
