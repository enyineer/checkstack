import type { CapturedLine, Supervisor } from "./supervisor.ts";
import type { ProcessId, ProcessStatus } from "./types.ts";

export interface FakeSupervisor extends Supervisor {
  /** Push a captured line to all line listeners (test helper). */
  emitLine(line: CapturedLine): void;
  /** Push a status change to all status listeners (test helper). */
  emitStatus(input: { id: ProcessId; status: ProcessStatus }): void;
  /** Whether {@link Supervisor.start} was called. */
  readonly started: boolean;
  /** Ids passed to {@link Supervisor.restart}, in order. */
  readonly restarted: readonly ProcessId[];
  /** Whether {@link Supervisor.shutdown} was called. */
  readonly didShutdown: boolean;
}

/**
 * In-memory Supervisor stand-in for smoke tests. Spawns nothing: it lets a test
 * drive line/status events deterministically and records lifecycle calls, so we
 * can exercise the UI and the plain runner without real child processes.
 */
export function createFakeSupervisor(): FakeSupervisor {
  const lineListeners: Array<(line: CapturedLine) => void> = [];
  const statusListeners: Array<
    (input: { id: ProcessId; status: ProcessStatus }) => void
  > = [];
  const statuses = new Map<ProcessId, ProcessStatus>([
    ["deps", "starting"],
    ["backend", "starting"],
    ["frontend", "starting"],
  ]);
  const restarted: ProcessId[] = [];
  let started = false;
  let didShutdown = false;

  return {
    start(): void {
      started = true;
    },
    restart(id: ProcessId): void {
      restarted.push(id);
    },
    statusOf(id: ProcessId): ProcessStatus {
      return statuses.get(id) ?? "stopped";
    },
    onLine(listener): void {
      lineListeners.push(listener);
    },
    onStatus(listener): void {
      statusListeners.push(listener);
    },
    async shutdown(): Promise<void> {
      didShutdown = true;
    },
    emitLine(line: CapturedLine): void {
      for (const listener of lineListeners) {
        listener(line);
      }
    },
    emitStatus(input: { id: ProcessId; status: ProcessStatus }): void {
      statuses.set(input.id, input.status);
      for (const listener of statusListeners) {
        listener(input);
      }
    },
    get started(): boolean {
      return started;
    },
    get restarted(): readonly ProcessId[] {
      return restarted;
    },
    get didShutdown(): boolean {
      return didShutdown;
    },
  };
}
