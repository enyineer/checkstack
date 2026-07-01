import type { LogLevel } from "../dev-tui/log-level.ts";
import type { ProcessStatus } from "../dev-tui/types.ts";

/** Terminal colour for a captured log line's level. */
export function levelColor(level: LogLevel): string {
  switch (level) {
    case "error":
      return "red";
    case "warn":
      return "yellow";
    case "debug":
      return "gray";
    default:
      return "white";
  }
}

/** Terminal colour for a process status dot. */
export function statusColor(status: ProcessStatus): string {
  switch (status) {
    case "ready":
      return "green";
    case "starting":
      return "yellow";
    case "errored":
      return "red";
    default:
      return "gray";
  }
}

/** Cockpit accent colour used for headers / active items. */
export const ACCENT = "cyan";
