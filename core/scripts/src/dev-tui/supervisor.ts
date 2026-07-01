import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { detectLogLevel, type LogLevel } from "./log-level.ts";
import { createLineSplitter } from "./text.ts";
import { matchesReady } from "./readiness.ts";
import { planKill } from "./kill-tree.ts";
import {
  getProcessDefs,
  type DevMode,
  type ProcessDef,
} from "./process-config.ts";
import type { ProcessId, ProcessStatus } from "./types.ts";

/** A single captured output line with its detected level and a sequence id. */
export interface CapturedLine {
  readonly source: ProcessId;
  readonly level: LogLevel;
  readonly text: string;
  readonly seq: number;
}

export interface SupervisorEvents {
  /** A new output line was captured from any process. */
  line: (line: CapturedLine) => void;
  /** A process changed status. */
  status: (input: { id: ProcessId; status: ProcessStatus }) => void;
}

export interface Supervisor {
  /** Start all processes. The deps task is started first. */
  start(): void;
  /** Restart a single process (kills its tree, then respawns). */
  restart(id: ProcessId): void;
  /**
   * Stop the long-running children (backend + frontend) and their trees.
   * Leaves the `-d` docker deps running, matching the existing `dev` script.
   */
  shutdown(): Promise<void>;
  /** Current status of a process. */
  statusOf(id: ProcessId): ProcessStatus;
  /** Subscribe to captured output lines. */
  onLine(listener: SupervisorEvents["line"]): void;
  /** Subscribe to status transitions. */
  onStatus(listener: SupervisorEvents["status"]): void;
}

interface RunningProcess {
  readonly def: ProcessDef;
  child?: ChildProcess;
  status: ProcessStatus;
}

/**
 * Compute a child process's environment: the parent env with the def's own env
 * merged OVER it (def values win on conflict). Returns the parent env unchanged
 * (same reference) when the def declares no overrides, so the common dev path is
 * allocation-free. Pure and exported for unit testing.
 */
export function buildChildEnv({
  parentEnv,
  defEnv,
}: {
  parentEnv: NodeJS.ProcessEnv;
  defEnv?: Readonly<Record<string, string>>;
}): NodeJS.ProcessEnv {
  if (!defEnv) return parentEnv;
  return { ...parentEnv, ...defEnv };
}

export interface CreateSupervisorInput {
  /** Working directory to spawn children in (the repo root). */
  cwd: string;
  /** Runner mode; `preview` serves the frontend production build. Default `dev`. */
  mode?: DevMode;
  /**
   * Explicit process definitions to supervise. When provided, these are used
   * verbatim instead of the built-in dev/preview defs derived from `mode`. The
   * PR-preview instance passes its own backend/frontend defs (custom `cwd` in a
   * merged worktree, and per-process `env`) here so one supervisor can drive a
   * secondary instance alongside the primary dev run.
   */
  defs?: readonly ProcessDef[];
}

/**
 * Spawns and supervises the dev processes. Children are spawned in their own
 * process group (POSIX) so the entire watcher tree can be torn down cleanly.
 * Output is split into lines, level-tagged, and emitted via `line` events;
 * status transitions are emitted via `status` events. All UI state derives from
 * these events, keeping the ink components thin.
 */
export function createSupervisor({
  cwd,
  mode = "dev",
  defs: injectedDefs,
}: CreateSupervisorInput): Supervisor {
  const defs = injectedDefs ?? getProcessDefs(mode);
  const processes = new Map<ProcessId, RunningProcess>();
  for (const def of defs) {
    processes.set(def.id, { def, status: "stopped" });
  }

  const lineListeners: SupervisorEvents["line"][] = [];
  const statusListeners: SupervisorEvents["status"][] = [];
  let seq = 0;

  const emitLine = (input: {
    source: ProcessId;
    text: string;
  }): void => {
    seq += 1;
    const line: CapturedLine = {
      source: input.source,
      text: input.text,
      level: detectLogLevel({ line: input.text }),
      seq,
    };
    for (const listener of lineListeners) {
      listener(line);
    }
  };

  const setStatus = (id: ProcessId, status: ProcessStatus): void => {
    const proc = processes.get(id);
    if (!proc || proc.status === status) {
      return;
    }
    proc.status = status;
    for (const listener of statusListeners) {
      listener({ id, status });
    }
  };

  const handleOutput = (id: ProcessId, oneShot: boolean) => {
    const split = createLineSplitter();
    return (chunk: Buffer): void => {
      const text = chunk.toString("utf8");
      for (const text_ of split(text)) {
        emitLine({ source: id, text: text_ });
        if (!oneShot && matchesReady({ id, line: text_ })) {
          setStatus(id, "ready");
        }
      }
    };
  };

  const spawnProcess = (id: ProcessId): void => {
    const proc = processes.get(id);
    if (!proc) {
      return;
    }
    const { def } = proc;

    setStatus(id, "starting");

    const child = spawn(def.command, [...def.args], {
      // Each process runs in its own package dir (relative to the root cwd) so
      // it streams that package's raw output; deps runs at the root.
      cwd: def.cwd === undefined ? cwd : path.join(cwd, def.cwd),
      // New process group on POSIX so we can kill the whole watcher tree.
      // On Windows this is ignored; taskkill /T handles the tree instead.
      detached: process.platform !== "win32",
      // A def's own env is merged OVER process.env so the PR-preview instance
      // can override PORT / BASE_URL / DATABASE_URL / CHECKSTACK_INSTANCE_NAMESPACE
      // while still inheriting the rest of the parent environment.
      env: buildChildEnv({ parentEnv: process.env, defEnv: def.env }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    proc.child = child;

    const onData = handleOutput(id, def.oneShot);
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);

    child.on("error", (error: Error) => {
      emitLine({ source: id, text: `error: failed to spawn ${def.command}: ${error.message}` });
      setStatus(id, "errored");
    });

    child.on("exit", (code: number | null) => {
      proc.child = undefined;
      if (def.oneShot) {
        // deps: zero exit = ready; anything else = errored.
        setStatus(id, code === 0 ? "ready" : "errored");
      } else if (code === 0 || code === null) {
        setStatus(id, "stopped");
      } else {
        setStatus(id, "errored");
      }
    });
  };

  const killProcess = (id: ProcessId): void => {
    const proc = processes.get(id);
    const child = proc?.child;
    if (!proc || !child || child.pid === undefined) {
      return;
    }
    const plan = planKill({ platform: process.platform, pid: child.pid });
    try {
      if (plan.kind === "signal") {
        process.kill(plan.target, plan.signal);
      } else {
        spawn(plan.command, [...plan.args], { stdio: "ignore" });
      }
    } catch {
      // Process already gone or group missing; nothing to do.
    }
  };

  return {
    start(): void {
      for (const def of defs) {
        spawnProcess(def.id);
      }
    },

    restart(id: ProcessId): void {
      killProcess(id);
      // Respawn on the next tick so the old child's exit is processed first.
      setTimeout(() => spawnProcess(id), 150);
    },

    statusOf(id: ProcessId): ProcessStatus {
      return processes.get(id)?.status ?? "stopped";
    },

    onLine(listener: SupervisorEvents["line"]): void {
      lineListeners.push(listener);
    },

    onStatus(listener: SupervisorEvents["status"]): void {
      statusListeners.push(listener);
    },

    async shutdown(): Promise<void> {
      // Only tear down the long-running children; leave docker deps (-d) up.
      const longRunning = defs.filter((def) => !def.oneShot);
      for (const def of longRunning) {
        killProcess(def.id);
      }
      // Give children a moment to exit on SIGTERM, then force-kill survivors.
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          for (const def of longRunning) {
            const proc = processes.get(def.id);
            const child = proc?.child;
            if (child?.pid !== undefined) {
              const plan = planKill({
                platform: process.platform,
                pid: child.pid,
                signal: "SIGKILL",
              });
              try {
                if (plan.kind === "signal") {
                  process.kill(plan.target, plan.signal);
                } else {
                  spawn(plan.command, [...plan.args], { stdio: "ignore" });
                }
              } catch {
                // Already gone.
              }
            }
          }
          resolve();
        }, 600);
      });
    },
  };
}
