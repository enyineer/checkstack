import type { CapturedLine, Supervisor } from "../dev-tui/supervisor.ts";
import type { ProcessId, ProcessStatus } from "../dev-tui/types.ts";

/** Cap on retained log lines per store (older lines are dropped). */
export const MAX_STORE_LINES = 1000;

export interface ProcessSnapshot {
  readonly lines: readonly CapturedLine[];
  readonly statuses: Readonly<Partial<Record<ProcessId, ProcessStatus>>>;
}

/**
 * A persistent, framework-agnostic store over a {@link Supervisor}. It subscribes
 * to the supervisor ONCE (at creation) and accumulates line + status state, so a
 * view can mount/unmount (e.g. when the user switches cockpit tabs) without
 * dropping output or double-subscribing. React reads it via `useProcessStore`.
 */
export interface ProcessStore {
  readonly supervisor: Supervisor;
  getSnapshot(): ProcessSnapshot;
  subscribe(listener: () => void): () => void;
  /** Start the supervisor exactly once (idempotent). */
  start(): void;
}

export function createProcessStore(supervisor: Supervisor): ProcessStore {
  let lines: CapturedLine[] = [];
  let statuses: Partial<Record<ProcessId, ProcessStatus>> = {};
  let snapshot: ProcessSnapshot = { lines, statuses };
  const listeners = new Set<() => void>();
  let started = false;

  const emit = (): void => {
    snapshot = { lines, statuses };
    for (const listener of listeners) listener();
  };

  supervisor.onLine((line) => {
    lines = lines.length >= MAX_STORE_LINES
      ? [...lines.slice(lines.length - MAX_STORE_LINES + 1), line]
      : [...lines, line];
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
    start() {
      if (started) return;
      started = true;
      supervisor.start();
    },
  };
}
