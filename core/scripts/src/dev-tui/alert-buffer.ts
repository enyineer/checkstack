import { isAlertLevel } from "./log-level.ts";
import type { AlertEntry } from "./types.ts";

export interface AlertBuffer {
  /** Add an entry; non-alert levels (info/debug) are silently ignored. */
  push(entry: AlertEntry): void;
  /** Current alerts, newest first, as a defensive copy. */
  list(): AlertEntry[];
  /** Drop all stored alerts. */
  clear(): void;
}

export interface CreateAlertBufferInput {
  /** Maximum number of alerts to retain. Oldest are dropped past this. */
  capacity: number;
}

/**
 * Bounded ring buffer that retains only the most recent warn/error entries
 * across every process, newest-first and capped at `capacity`. This is what
 * keeps the script-sandbox readiness banner and any error pinned in the Alerts
 * panel instead of scrolling out of view.
 */
export function createAlertBuffer({
  capacity,
}: CreateAlertBufferInput): AlertBuffer {
  if (!Number.isInteger(capacity) || capacity <= 0) {
    throw new Error(`Alert buffer capacity must be a positive integer, got ${capacity}`);
  }

  // Stored oldest-first; `list()` reverses to newest-first.
  let entries: AlertEntry[] = [];

  return {
    push(entry: AlertEntry): void {
      if (!isAlertLevel(entry.level)) {
        return;
      }
      entries.push(entry);
      if (entries.length > capacity) {
        entries = entries.slice(entries.length - capacity);
      }
    },
    list(): AlertEntry[] {
      return entries.toReversed();
    },
    clear(): void {
      entries = [];
    },
  };
}
