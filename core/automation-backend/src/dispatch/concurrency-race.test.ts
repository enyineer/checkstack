import { describe, expect, it } from "bun:test";
import { SYSTEM_ACTOR } from "@checkstack/common";
import { AutomationDefinitionSchema } from "@checkstack/automation-common";
import type { AutomationStore } from "../automation-store";
import { createActionRegistry } from "../action-registry";
import { recoverStalledRun, resumeRun } from "./engine";
import { handleTriggerFiring } from "./trigger-subscriber";
import { makeDispatchDeps, makeRecordingAction, testPlugin } from "./test-fixtures";
import type { DispatchDeps, LoadedAutomation } from "./types";

const EVENT = "test.event";

/** Single-mode automation whose run stays active (waits forever). */
function buildAutomation(): LoadedAutomation {
  const definition = AutomationDefinitionSchema.parse({
    name: "Race test",
    triggers: [{ event: EVENT }],
    conditions: [],
    actions: [{ wait_for_trigger: { event: "never.fires" } }],
    mode: "single",
    max_runs: 10,
  });
  return { id: "auto-1", name: "Race test", status: "enabled", definition };
}

function storeFor(auto: LoadedAutomation): AutomationStore {
  return {
    create: async () => {
      throw new Error("nope");
    },
    update: async () => {
      throw new Error("nope");
    },
    delete: async () => {},
    toggle: async () => {
      throw new Error("nope");
    },
    getById: async () => undefined,
    list: async () => ({ items: [], total: 0 }),
    findEnabledByTriggerEvent: async () => [auto],
    listEnabled: async () => [auto],
  };
}

function activeCount(runs: ReturnType<typeof makeDispatchDeps>["runs"]): number {
  return [...runs.runs.values()].filter((r) =>
    ["pending", "running", "waiting"].includes(r.status),
  ).length;
}

describe("M1 — concurrency check-then-create race (single mode)", () => {
  it("two concurrent fires create exactly one run", async () => {
    const actionsReg = createActionRegistry();
    actionsReg.register(makeRecordingAction().definition, testPlugin);
    const { deps, runs } = makeDispatchDeps({
      actions: actionsReg,
      withConcurrencyLock: true,
    });
    const auto = buildAutomation();

    // Widen the check-then-create window with a real async gap, so that
    // WITHOUT serialization both fires can complete their "is a run active?"
    // check before either has created its run — the exact interleaving that
    // double-runs a single-mode automation. WITH the lock, the second fire
    // blocks at lock-acquire and only checks after the first committed, so
    // the gap is harmless. (Macrotask yield, not a 2-party barrier, so it
    // works in both the locked and unlocked variants without deadlock.)
    const realHasActiveRun = deps.runStore.hasActiveRun.bind(deps.runStore);
    deps.runStore.hasActiveRun = async (automationId, contextKey) => {
      const result = await realHasActiveRun(automationId, contextKey);
      await new Promise((r) => setTimeout(r, 5));
      return result;
    };

    const fire = () =>
      handleTriggerFiring({
        deps,
        automationStore: storeFor(auto),
        qualifiedEventId: EVENT,
        triggerPayload: { id: "sys-1" },
        actor: SYSTEM_ACTOR,
        contextKey: "sys-1",
      });

    await Promise.all([fire(), fire()]);

    expect(activeCount(runs)).toBe(1);
  });
});

// ─── Resume-vs-recover same-run race ─────────────────────────────────────

/**
 * Wrap a recover the way `stalled-sweeper.ts` does: acquire the per-run
 * advisory lock FIRST, then recover, releasing in a finally. The lock is the
 * cross-path arbiter — the SAME `Set`-backed advisory-lock fake (one Set
 * across both paths) is what makes "exactly one executes" hold across a
 * sweeper-recover racing a wake-driven resume / a second sweeper.
 */
async function sweeperRecover(
  deps: DispatchDeps,
  args: { runId: string; automation: LoadedAutomation },
): Promise<{ acted: boolean }> {
  const lock = await deps.runStateStore.tryAdvisoryLock(args.runId);
  if (!lock) return { acted: false }; // another instance already on it
  try {
    await recoverStalledRun(deps, args);
    return { acted: true };
  } finally {
    await lock.release();
  }
}

/** An automation: one recording action, gated behind a wait, then another. */
function recoverableAutomation(actionsReg: ReturnType<typeof createActionRegistry>): {
  auto: LoadedAutomation;
  recorded: () => number;
} {
  const recording = makeRecordingAction();
  actionsReg.register(recording.definition, testPlugin);
  const definition = AutomationDefinitionSchema.parse({
    name: "Recover race",
    triggers: [{ event: EVENT }],
    conditions: [],
    actions: [
      { action: "test.record", config: { value: "after-recover" } },
    ],
    mode: "single",
    max_runs: 10,
  });
  return {
    auto: { id: "auto-1", name: "Recover race", status: "enabled", definition },
    recorded: () => recording.calls.length,
  };
}

describe("M2 — resume-vs-recover same-run race (shared advisory lock)", () => {
  it("two sweeper recoveries of one stalled run: exactly one executes", async () => {
    const actionsReg = createActionRegistry();
    const { auto, recorded } = recoverableAutomation(actionsReg);
    const { deps, runs, state } = makeDispatchDeps({ actions: actionsReg });

    // A genuinely-stalled run: status `running`, a persisted snapshot, and no
    // wait lock — exactly what `recoverStalledRun` is allowed to re-walk.
    const runId = "run-stalled";
    runs.runs.set(runId, {
      id: runId,
      automationId: auto.id,
      triggerId: "t",
      triggerEventId: EVENT,
      triggerPayload: {},
      contextKey: null,
      status: "running",
      errorMessage: null,
      startedAt: new Date(),
      finishedAt: null,
    });
    state.states.set(runId, {
      scopeSnapshot: { trigger: { id: "t", event: EVENT, payload: {} } },
      lastActionPath: null, // crashed before the first step → from the top
      lastHeartbeatAt: new Date(0),
    });

    // Two pods sweep the same stalled run at once; the shared `locks` Set
    // (state.locks) arbitrates.
    const [a, b] = await Promise.all([
      sweeperRecover(deps, { runId, automation: auto }),
      sweeperRecover(deps, { runId, automation: auto }),
    ]);

    expect([a.acted, b.acted].filter(Boolean)).toHaveLength(1);
    expect(recorded()).toBe(1); // the action ran exactly once
    expect(runs.runs.get(runId)!.status).toBe("success");
    expect(state.locks.size).toBe(0); // lock released by the winner
  });

  it("a resume racing a recover for the same waiting run: the wake wins, recover no-ops", async () => {
    const actionsReg = createActionRegistry();
    const recording = makeRecordingAction();
    actionsReg.register(recording.definition, testPlugin);
    const definition = AutomationDefinitionSchema.parse({
      name: "Resume race",
      triggers: [{ event: EVENT }],
      conditions: [],
      actions: [
        { wait_for_trigger: { event: "wake.event" } },
        { action: "test.record", config: { value: "post-wait" } },
      ],
      mode: "single",
      max_runs: 10,
    });
    const auto: LoadedAutomation = {
      id: "auto-1",
      name: "Resume race",
      status: "enabled",
      definition,
    };
    const { deps, runs, state } = makeDispatchDeps({ actions: actionsReg });

    // A run intentionally suspended at the wait: status `waiting`, snapshot at
    // the wait, plus a wait lock. `resumeRun` (the wake path) owns it; a
    // sweeper recover must refuse (status not `running` + a live wait lock).
    const runId = "run-waiting";
    runs.runs.set(runId, {
      id: runId,
      automationId: auto.id,
      triggerId: "t",
      triggerEventId: EVENT,
      triggerPayload: {},
      contextKey: null,
      status: "waiting",
      errorMessage: null,
      startedAt: new Date(),
      finishedAt: null,
    });
    state.states.set(runId, {
      scopeSnapshot: { trigger: { id: "t", event: EVENT, payload: {} } },
      lastActionPath: "actions[0]",
      lastHeartbeatAt: new Date(),
    });
    await deps.runStore.createWaitLock({
      runId,
      actionPath: "actions[0]",
      kind: "trigger",
      eventId: "wake.event",
      contextKey: null,
      filterTemplate: null,
      timeoutAt: null,
    });

    // `recoverStalledRun` is invoked DIRECTLY (not under the sweeper lock
    // wrapper) — faithful to production, where the sweeper only ever
    // *recovers* `running` runs and never competes for a `waiting` run's
    // lock (it filters on status and runs the wait paths first). So recover
    // here must refuse on its own status / wait-lock guard, leaving the
    // wake-driven `resumeRun` to own + complete the run.
    const [resumeOut, recoverOut] = await Promise.all([
      resumeRun(deps, {
        runId,
        automation: auto,
        waitedAtPath: "actions[0]",
      }),
      recoverStalledRun(deps, { runId, automation: auto }),
    ]);

    // Recover refused (saw a non-`running` / wait-locked run); resume woke +
    // completed it. The post-wait action ran EXACTLY once.
    expect(recoverOut.status).toBe("waiting"); // refused, did not re-walk
    expect(recording.calls).toHaveLength(1);
    expect(resumeOut.status).toBe("success");
    expect(runs.runs.get(runId)!.status).toBe("success");
    expect(state.locks.size).toBe(0);
  });
});
