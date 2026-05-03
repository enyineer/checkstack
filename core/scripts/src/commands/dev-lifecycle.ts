/**
 * Backend child-process lifecycle (spawn → restart-on-watch →
 * graceful-shutdown), extracted behind injectable seams so we can drive
 * it from unit tests without launching real processes.
 *
 * Three injectable adapters:
 *
 *   - `spawner`: `spawn` the child and return a handle exposing `kill`
 *     + an `onExit` hook. Real impl wraps `node:child_process.spawn`;
 *     test impls use `EventEmitter`-backed fakes.
 *   - `setHardKillTimer` / `clearHardKillTimer`: scheduling for the
 *     SIGTERM-→-SIGKILL escalation.
 *   - `onLog`: where to send human-readable status lines. Tests collect
 *     them into an array; real impl uses `console.log`.
 *
 * The lifecycle's *behavior* is fully captured by these primitives:
 * tests that drive them confirm the same code paths the real runtime
 * exercises.
 */

export interface ChildHandle {
  kill(signal: NodeJS.Signals): void;
  onExit(handler: (code: number | null, signal: NodeJS.Signals | null) => void): void;
}

export interface Spawner {
  spawn(input: {
    command: string;
    args: string[];
    env: Record<string, string | undefined>;
  }): ChildHandle;
}

export interface LifecycleHooks {
  /** Called when the child exits naturally (not as part of a restart). */
  onNaturalExit: (code: number | null) => void;
}

export interface BackendLifecycleOptions {
  spawnArgs: { command: string; args: string[]; env: Record<string, string | undefined> };
  spawner: Spawner;
  hooks: LifecycleHooks;
  /** Inject log sink. Defaults to `console.log`. */
  onLog?: (line: string) => void;
  /** Schedule a SIGKILL fallback if SIGTERM doesn't bring the child down. */
  setHardKillTimer?: (fn: () => void, ms: number) => unknown;
  clearHardKillTimer?: (handle: unknown) => void;
  hardKillDelayMs?: number;
}

export interface BackendLifecycle {
  /** Start the child for the first time. */
  start: () => void;
  /** Trigger a restart (SIGTERM + respawn). Idempotent during a restart. */
  restart: () => void;
  /** Forward a shutdown signal to the child. Marks the lifecycle as done. */
  shutdown: (signal: NodeJS.Signals) => void;
}

export function createBackendLifecycle({
  spawnArgs,
  spawner,
  hooks,
  onLog = (line) => console.log(line),
  setHardKillTimer = (fn, ms) => setTimeout(fn, ms),
  clearHardKillTimer = (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  hardKillDelayMs = 5000,
}: BackendLifecycleOptions): BackendLifecycle {
  let child: ChildHandle | undefined;
  let restarting = false;
  let shuttingDown = false;
  let hardKillHandle: unknown;

  const start = () => {
    if (child) return; // start() must be called only once outside a restart
    onLog(`▶ Starting backend (${spawnArgs.command} ${spawnArgs.args.join(" ")})`);
    child = spawner.spawn(spawnArgs);
    child.onExit((code, signal) => {
      child = undefined;
      // The hard-kill timer is no longer relevant once the child is
      // gone — drop it before we possibly schedule another one.
      if (hardKillHandle !== undefined) {
        clearHardKillTimer(hardKillHandle);
        hardKillHandle = undefined;
      }
      if (shuttingDown) return;
      if (restarting) {
        restarting = false;
        // Recursive call into start() is safe: child is undefined here
        // and the function early-returns when it's not.
        spawnAfterRestart();
        return;
      }
      onLog(
        `Backend exited (code=${code ?? "null"}, signal=${signal ?? "none"})`,
      );
      hooks.onNaturalExit(code);
    });
  };

  // Same as `start()` but issued during a restart, so logging differs
  // and the early-return is bypassed (child has just been cleared).
  const spawnAfterRestart = () => {
    onLog(`▶ Starting backend (${spawnArgs.command} ${spawnArgs.args.join(" ")})`);
    child = spawner.spawn(spawnArgs);
    child.onExit((code, signal) => {
      child = undefined;
      if (hardKillHandle !== undefined) {
        clearHardKillTimer(hardKillHandle);
        hardKillHandle = undefined;
      }
      if (shuttingDown) return;
      if (restarting) {
        restarting = false;
        spawnAfterRestart();
        return;
      }
      onLog(
        `Backend exited (code=${code ?? "null"}, signal=${signal ?? "none"})`,
      );
      hooks.onNaturalExit(code);
    });
  };

  const restart = () => {
    if (!child || restarting || shuttingDown) return;
    restarting = true;
    onLog("♻ Plugin source changed — restarting backend...");
    child.kill("SIGTERM");
    // Hard-kill fallback: if SIGTERM doesn't bring the child down in
    // `hardKillDelayMs`, escalate. Otherwise the dev loop hangs forever
    // when a plugin's cleanup handler is buggy.
    hardKillHandle = setHardKillTimer(() => {
      if (child && restarting) {
        child.kill("SIGKILL");
      }
    }, hardKillDelayMs);
  };

  const shutdown = (signal: NodeJS.Signals) => {
    shuttingDown = true;
    if (child) child.kill(signal);
  };

  return { start, restart, shutdown };
}

/**
 * Real `node:child_process.spawn`-backed Spawner. Production code uses
 * this; tests inject a fake.
 */
export function nodeSpawner({
  spawnFn,
}: {
  spawnFn: typeof import("node:child_process").spawn;
}): Spawner {
  return {
    spawn({ command, args, env }) {
      const proc = spawnFn(command, args, {
        env: env as NodeJS.ProcessEnv,
        stdio: "inherit",
      });
      return {
        kill(signal) {
          proc.kill(signal);
        },
        onExit(handler) {
          proc.on("exit", handler);
        },
      };
    },
  };
}
