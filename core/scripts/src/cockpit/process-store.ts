import type { Supervisor } from "../dev-tui/supervisor.ts";
import type { ProcessId, ProcessStatus, AlertEntry } from "../dev-tui/types.ts";
import {
  createScrollback,
  type Scrollback,
  type ScrollbackLine,
} from "../dev-tui/scrollback.ts";
import { createAlertBuffer } from "../dev-tui/alert-buffer.ts";
import { isAlertLevel } from "../dev-tui/log-level.ts";

/** Per-process retained-line cap. */
export const SCROLLBACK_CAPACITY = 5000;
/** Shared warn/error ring-buffer cap (pinned alerts panel). */
export const ALERTS_CAPACITY = 8;

export interface ProcessSnapshot {
  readonly statuses: Readonly<Partial<Record<ProcessId, ProcessStatus>>>;
  /** Newest-first warn/error entries across all processes (capped). */
  readonly alerts: readonly AlertEntry[];
  /** Monotonic count of alert lines seen per process (for unread badges). */
  readonly alertCounts: Readonly<Partial<Record<ProcessId, number>>>;
  /** Bumps on every appended line so scrollback windows recompute. */
  readonly tick: number;
}

/**
 * A persistent, framework-agnostic store over a {@link Supervisor}. Subscribes
 * ONCE at creation and maintains: per-process scrollback buffers, a shared alert
 * ring buffer, per-process status, and monotonic per-process alert counts. A
 * view mounts/unmounts (cockpit tab switches) without dropping output or
 * double-subscribing. React reads it via `useProcessStore`.
 */
export interface ProcessStore {
  readonly supervisor: Supervisor;
  getSnapshot(): ProcessSnapshot;
  subscribe(listener: () => void): () => void;
  /** Windowed slice of a process's scrollback for the given viewport. */
  windowFor(input: {
    id: ProcessId;
    height: number;
    scrollOffset: number;
  }): ScrollbackLine[];
  /** Start the supervisor exactly once (idempotent). */
  start(): void;
}

export function createProcessStore(supervisor: Supervisor): ProcessStore {
  const scrollbacks = new Map<ProcessId, Scrollback>();
  const alertBuffer = createAlertBuffer({ capacity: ALERTS_CAPACITY });
  let statuses: Partial<Record<ProcessId, ProcessStatus>> = {};
  let alertCounts: Partial<Record<ProcessId, number>> = {};
  let tick = 0;
  let snapshot: ProcessSnapshot = {
    statuses,
    alerts: [],
    alertCounts,
    tick,
  };
  const listeners = new Set<() => void>();
  let started = false;

  const emit = (): void => {
    snapshot = { statuses, alerts: alertBuffer.list(), alertCounts, tick };
    for (const listener of listeners) listener();
  };

  const scrollbackFor = (id: ProcessId): Scrollback => {
    let sb = scrollbacks.get(id);
    if (!sb) {
      sb = createScrollback({ capacity: SCROLLBACK_CAPACITY });
      scrollbacks.set(id, sb);
    }
    return sb;
  };

  supervisor.onLine((line) => {
    scrollbackFor(line.source).append({ text: line.text, level: line.level });
    tick += 1;
    if (isAlertLevel(line.level)) {
      alertBuffer.push({
        source: line.source,
        level: line.level,
        text: line.text,
        seq: line.seq,
      });
      alertCounts = {
        ...alertCounts,
        [line.source]: (alertCounts[line.source] ?? 0) + 1,
      };
    }
    emit();
  });
  supervisor.onStatus(({ id, status }) => {
    statuses = { ...statuses, [id]: status };
    emit();
  });

  return {
    supervisor,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    windowFor({ id, height, scrollOffset }) {
      return scrollbacks.get(id)?.window({ height, scrollOffset }) ?? [];
    },
    start() {
      if (started) return;
      started = true;
      supervisor.start();
    },
  };
}
