import type { LogLevel } from "./log-level.ts";

/** One stored output line with its detected level (for coloring). */
export interface ScrollbackLine {
  readonly text: string;
  readonly level: LogLevel;
}

export interface ScrollbackWindowInput {
  /** Number of visible rows in the main pane. */
  height: number;
  /**
   * How many lines above the tail to scroll. 0 = follow the newest output;
   * larger values move the window towards older history (clamped).
   */
  scrollOffset: number;
}

export interface Scrollback {
  append(line: ScrollbackLine): void;
  /** All retained lines, oldest-first (defensive copy). */
  lines(): ScrollbackLine[];
  /** Number of lines currently retained (<= capacity). */
  size(): number;
  /** Number of lines ever appended (for an overflow indicator). */
  totalAppended(): number;
  /** The slice of lines visible for a given viewport height and scroll offset. */
  window(input: ScrollbackWindowInput): ScrollbackLine[];
}

export interface CreateScrollbackInput {
  /** Maximum number of lines to retain per process. */
  capacity: number;
}

/**
 * Bounded scrollback buffer for one process's output. Keeps the last
 * `capacity` lines and exposes a `window()` that follows the tail by default
 * and supports scrolling back through retained history.
 */
export function createScrollback({
  capacity,
}: CreateScrollbackInput): Scrollback {
  if (!Number.isInteger(capacity) || capacity <= 0) {
    throw new Error(
      `Scrollback capacity must be a positive integer, got ${capacity}`,
    );
  }

  let buffer: ScrollbackLine[] = [];
  let total = 0;

  return {
    append(line: ScrollbackLine): void {
      buffer.push(line);
      total += 1;
      if (buffer.length > capacity) {
        buffer = buffer.slice(buffer.length - capacity);
      }
    },
    lines(): ScrollbackLine[] {
      return [...buffer];
    },
    size(): number {
      return buffer.length;
    },
    totalAppended(): number {
      return total;
    },
    window({ height, scrollOffset }: ScrollbackWindowInput): ScrollbackLine[] {
      const visibleHeight = Math.max(1, Math.floor(height));
      if (buffer.length <= visibleHeight) {
        return [...buffer];
      }
      const maxOffset = buffer.length - visibleHeight;
      const offset = Math.min(Math.max(0, Math.floor(scrollOffset)), maxOffset);
      const end = buffer.length - offset;
      const start = end - visibleHeight;
      return buffer.slice(start, end);
    },
  };
}
