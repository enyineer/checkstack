import { describe, it, expect } from "bun:test";
import {
  createBackendLifecycle,
  type ChildHandle,
  type Spawner,
} from "./dev-lifecycle";

/**
 * Fake child + spawner. Records every spawn, every kill signal, and lets
 * tests synthesize an exit by calling `simulateExit`. The lifecycle code
 * does not care about real I/O — only about the lifecycle hooks
 * (`kill` + `onExit`) — so this is a complete double for it.
 */
function makeFakeSpawner() {
  interface FakeChild {
    handle: ChildHandle;
    spawnArgs: { command: string; args: string[]; env: Record<string, string | undefined> };
    killSignals: NodeJS.Signals[];
    exitHandlers: Array<
      (code: number | null, signal: NodeJS.Signals | null) => void
    >;
    exited: boolean;
    /** Trigger the registered onExit handlers. */
    simulateExit: (code: number | null, signal?: NodeJS.Signals | null) => void;
  }
  const children: FakeChild[] = [];

  const spawner: Spawner = {
    spawn(spawnArgs) {
      const fake: FakeChild = {
        handle: undefined as never,
        spawnArgs,
        killSignals: [],
        exitHandlers: [],
        exited: false,
        simulateExit: (code, signal = null) => {
          if (fake.exited) return;
          fake.exited = true;
          for (const handler of fake.exitHandlers) handler(code, signal);
        },
      };
      fake.handle = {
        kill: (signal: NodeJS.Signals) => {
          fake.killSignals.push(signal);
        },
        onExit: (handler) => {
          fake.exitHandlers.push(handler);
        },
      };
      children.push(fake);
      return fake.handle;
    },
  };
  return { spawner, children };
}

/**
 * Mini fake clock for the SIGKILL escalation timer. Tracks scheduled
 * callbacks; tests advance time explicitly. We do not use a real
 * setTimeout because we don't want to wait 5s in unit tests.
 */
function makeFakeClock() {
  interface T {
    handle: number;
    fireAt: number;
    fn: () => void;
  }
  const scheduled = new Map<number, T>();
  let now = 0;
  let nextHandle = 1;
  return {
    setTimer: (fn: () => void, ms: number) => {
      const handle = nextHandle++;
      scheduled.set(handle, { handle, fireAt: now + ms, fn });
      return handle;
    },
    clearTimer: (h: unknown) => {
      scheduled.delete(h as number);
    },
    advance: (ms: number) => {
      now += ms;
      const due = [...scheduled.values()]
        .filter((t) => t.fireAt <= now)
        .toSorted((a, b) => a.fireAt - b.fireAt);
      for (const t of due) {
        scheduled.delete(t.handle);
        t.fn();
      }
    },
    pending: () => [...scheduled.values()],
  };
}

const SPAWN_ARGS = {
  command: "bun",
  args: ["run", "/path/to/backend/src/index.ts"],
  env: { CHECKSTACK_DEV_AUTH: "true" },
};

describe("createBackendLifecycle", () => {
  it("start() spawns exactly one child with the given args", () => {
    const { spawner, children } = makeFakeSpawner();
    const lc = createBackendLifecycle({
      spawnArgs: SPAWN_ARGS,
      spawner,
      hooks: { onNaturalExit: () => {} },
      onLog: () => {},
    });
    lc.start();
    expect(children).toHaveLength(1);
    expect(children[0].spawnArgs).toEqual(SPAWN_ARGS);
  });

  it("start() is idempotent — calling twice doesn't double-spawn", () => {
    const { spawner, children } = makeFakeSpawner();
    const lc = createBackendLifecycle({
      spawnArgs: SPAWN_ARGS,
      spawner,
      hooks: { onNaturalExit: () => {} },
      onLog: () => {},
    });
    lc.start();
    lc.start();
    expect(children).toHaveLength(1);
  });

  it("natural exit invokes onNaturalExit hook with the exit code", () => {
    const { spawner, children } = makeFakeSpawner();
    let capturedCode: number | null | undefined;
    const lc = createBackendLifecycle({
      spawnArgs: SPAWN_ARGS,
      spawner,
      hooks: {
        onNaturalExit: (code) => {
          capturedCode = code;
        },
      },
      onLog: () => {},
    });
    lc.start();
    children[0].simulateExit(0);
    expect(capturedCode).toBe(0);
  });

  it("restart() sends SIGTERM to the running child and respawns after exit", () => {
    const { spawner, children } = makeFakeSpawner();
    const lc = createBackendLifecycle({
      spawnArgs: SPAWN_ARGS,
      spawner,
      hooks: { onNaturalExit: () => {} },
      onLog: () => {},
    });
    lc.start();
    expect(children).toHaveLength(1);

    lc.restart();
    expect(children[0].killSignals).toEqual(["SIGTERM"]);
    expect(children).toHaveLength(1); // not yet — child must exit first

    // Simulate the child cleaning up and exiting after SIGTERM
    children[0].simulateExit(null, "SIGTERM");
    expect(children).toHaveLength(2);
    expect(children[1].spawnArgs).toEqual(SPAWN_ARGS);
  });

  it("restart() during an in-flight restart is a no-op (idempotent)", () => {
    const { spawner, children } = makeFakeSpawner();
    const lc = createBackendLifecycle({
      spawnArgs: SPAWN_ARGS,
      spawner,
      hooks: { onNaturalExit: () => {} },
      onLog: () => {},
    });
    lc.start();
    lc.restart();
    lc.restart(); // double-fire while still restarting
    lc.restart();
    expect(children[0].killSignals).toEqual(["SIGTERM"]); // still just one
  });

  it("multiple sequential restarts work — child cycles through", () => {
    const { spawner, children } = makeFakeSpawner();
    const lc = createBackendLifecycle({
      spawnArgs: SPAWN_ARGS,
      spawner,
      hooks: { onNaturalExit: () => {} },
      onLog: () => {},
    });
    lc.start();
    // Restart 1
    lc.restart();
    children[0].simulateExit(null, "SIGTERM");
    // Restart 2
    lc.restart();
    children[1].simulateExit(null, "SIGTERM");
    expect(children).toHaveLength(3);
  });

  it("exit during natural shutdown after restart() is treated as a restart", () => {
    // i.e. the lifecycle did issue the SIGTERM, the child took time but
    // exited cleanly with code 0 — we should still spawn the replacement
    // because the user asked for a restart.
    const { spawner, children } = makeFakeSpawner();
    const naturalExits: Array<number | null> = [];
    const lc = createBackendLifecycle({
      spawnArgs: SPAWN_ARGS,
      spawner,
      hooks: { onNaturalExit: (code) => naturalExits.push(code) },
      onLog: () => {},
    });
    lc.start();
    lc.restart();
    children[0].simulateExit(0);
    expect(children).toHaveLength(2);
    expect(naturalExits).toEqual([]);
  });

  it("hard-kill timer fires SIGKILL when SIGTERM doesn't bring the child down in time", () => {
    const { spawner, children } = makeFakeSpawner();
    const clock = makeFakeClock();
    const lc = createBackendLifecycle({
      spawnArgs: SPAWN_ARGS,
      spawner,
      hooks: { onNaturalExit: () => {} },
      onLog: () => {},
      setHardKillTimer: clock.setTimer,
      clearHardKillTimer: clock.clearTimer,
      hardKillDelayMs: 5000,
    });
    lc.start();
    lc.restart();
    expect(children[0].killSignals).toEqual(["SIGTERM"]);
    expect(clock.pending()).toHaveLength(1);

    // Advance past the hard-kill threshold without simulating exit.
    clock.advance(5000);
    expect(children[0].killSignals).toEqual(["SIGTERM", "SIGKILL"]);

    // Eventually the OS does kill it. The replacement should still spawn.
    children[0].simulateExit(137, "SIGKILL");
    expect(children).toHaveLength(2);
  });

  it("hard-kill timer is cleared if the child exits before the deadline", () => {
    const { spawner, children } = makeFakeSpawner();
    const clock = makeFakeClock();
    const lc = createBackendLifecycle({
      spawnArgs: SPAWN_ARGS,
      spawner,
      hooks: { onNaturalExit: () => {} },
      onLog: () => {},
      setHardKillTimer: clock.setTimer,
      clearHardKillTimer: clock.clearTimer,
      hardKillDelayMs: 5000,
    });
    lc.start();
    lc.restart();
    children[0].simulateExit(null, "SIGTERM");
    // Replacement should be running with no leftover hard-kill timer
    expect(clock.pending()).toHaveLength(0);
    expect(children).toHaveLength(2);
  });

  it("shutdown(signal) forwards the signal and prevents the natural-exit hook from triggering a respawn loop", () => {
    const { spawner, children } = makeFakeSpawner();
    let naturalExits = 0;
    const lc = createBackendLifecycle({
      spawnArgs: SPAWN_ARGS,
      spawner,
      hooks: { onNaturalExit: () => naturalExits++ },
      onLog: () => {},
    });
    lc.start();
    lc.shutdown("SIGINT");
    expect(children[0].killSignals).toEqual(["SIGINT"]);
    children[0].simulateExit(0, "SIGINT");
    // Natural exit hook NOT called during a shutdown — process.exit
    // happens via the parent's signal handler instead.
    expect(naturalExits).toBe(0);
    expect(children).toHaveLength(1); // no respawn
  });

  it("shutdown() called before start() is a safe no-op", () => {
    const { spawner, children } = makeFakeSpawner();
    const lc = createBackendLifecycle({
      spawnArgs: SPAWN_ARGS,
      spawner,
      hooks: { onNaturalExit: () => {} },
      onLog: () => {},
    });
    lc.shutdown("SIGTERM");
    expect(children).toHaveLength(0);
  });

  it("restart() after shutdown() is ignored (we're already shutting down)", () => {
    const { spawner, children } = makeFakeSpawner();
    const lc = createBackendLifecycle({
      spawnArgs: SPAWN_ARGS,
      spawner,
      hooks: { onNaturalExit: () => {} },
      onLog: () => {},
    });
    lc.start();
    lc.shutdown("SIGTERM");
    lc.restart();
    // Only the shutdown signal made it to the child
    expect(children[0].killSignals).toEqual(["SIGTERM"]);
  });

  it("logs key lifecycle events through the injected onLog", () => {
    const { spawner, children } = makeFakeSpawner();
    const logs: string[] = [];
    const lc = createBackendLifecycle({
      spawnArgs: SPAWN_ARGS,
      spawner,
      hooks: { onNaturalExit: () => {} },
      onLog: (line) => logs.push(line),
    });
    lc.start();
    lc.restart();
    children[0].simulateExit(null, "SIGTERM");
    expect(logs.some((l) => l.includes("Starting backend"))).toBe(true);
    expect(logs.some((l) => l.includes("Plugin source changed"))).toBe(true);
    // After respawn, we log the start line again
    expect(logs.filter((l) => l.includes("Starting backend"))).toHaveLength(2);
  });
});
