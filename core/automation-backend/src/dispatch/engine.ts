/**
 * Automation dispatch engine.
 *
 * Walks an automation's action tree, executing each of the 10 primitive
 * kinds (`action`, `choose`, `parallel`, `delay`, `repeat`, `variables`,
 * `condition`, `stop`, `wait_for_trigger`, `sequence`). Persists run +
 * step state via the `RunStore`, scope snapshots via the
 * `RunStateStore`, and queue-backed suspensions via the `QueueManager`.
 *
 * Durability properties guaranteed by this engine:
 *
 *   1. **Restart safety.** After every successful step the engine
 *      writes a scope snapshot keyed on `runId`. If the host process
 *      dies, the stalled-run sweeper (`stalled-sweeper.ts`) picks up
 *      any run whose heartbeat is older than the threshold, acquires
 *      a Postgres advisory lock, and resumes from the snapshot.
 *
 *   2. **Horizontal scaling.** All trigger subscriptions use
 *      `mode: "work-queue"` so exactly one instance processes a given
 *      trigger event. Resume paths additionally take a Postgres
 *      session-level advisory lock per runId, so even two sweepers
 *      racing for the same stalled run can't both execute it.
 *
 *   3. **Suspensions anywhere.** `wait_for_trigger` and `delay` are
 *      supported at the top level, inside any depth of `choose`, inside
 *      `parallel` branches (each branch's state is tracked on the
 *      parallel step's `result_payload.branchOutcomes` so a resume
 *      doesn't re-execute siblings), and inside `repeat` iterations
 *      (the loop continues from the iteration after the resumed one;
 *      for_each lists are cached on the step so the iteration order is
 *      stable across the suspension). The `sequence` primitive wraps
 *      multi-action branches so a parallel branch can hold a full
 *      open/wait/close lifecycle.
 *
 *   4. **Queue-backed delay.** Every `delay` action persists a wait
 *      lock of `kind: "delay"` AND enqueues a scheduled job on the
 *      `automation-delay` queue. The queue is the wake-up trigger;
 *      the lock is the durable state. If the queue job is lost (Redis
 *      flush, etc.) the stalled sweeper still catches the expired
 *      lock at its `timeoutAt`.
 *
 *   5. **Stalled-recovery safety boundary.** The sweeper refuses to
 *      recover a run whose last-completed action is inside a `parallel`
 *      branch when no wait lock exists — branch concurrency state was
 *      lost, so neither re-running nor skip-and-continue is safe.
 *      Intentional waits inside parallel branches use the wait-lock
 *      resume path and are unaffected.
 */
import type {
  Action,
  ChooseInput,
  ConditionGuardInput,
  DelayInput,
  ParallelInput,
  ProviderAction,
  RepeatInput,
  SequenceInput,
  StopInput,
  VariablesInput,
  WaitForTriggerInput,
  WaitUntilInput,
} from "@checkstack/automation-common";
import { SYSTEM_ACTOR, type Actor } from "@checkstack/common";
import type {
  TemplateContext,
} from "@checkstack/template-engine";

import type { ActionRunScope } from "../action-types";
import { detectActionKind, type ActionKind } from "./action-kind";
import { wrapGetServiceForRun } from "./run-secret-registry";
import { evaluateCondition } from "./condition";
import { parseActionPath } from "./path-nav";
import {
  renderConfig,
  renderExpression,
  renderString,
  renderValue,
} from "./render";
import {
  buildInitialScope,
  extendVariables,
  resolveConsumedArtifacts,
  withRepeatContext,
} from "./scope";
import { enrichScopeWithState } from "./state-scope";
import {
  formatActionPath,
  type ActionPath,
  type DispatchContext,
  type DispatchDeps,
  type LoadedAutomation,
  type SequenceOutcome,
  type StepOutcome,
} from "./types";

/**
 * Per-run deps whose `getService` registers every resolved secret value
 * into the run-scoped secret registry (for run-wide output masking). When
 * the registry / ref-ids aren't configured (tests / minimal installs),
 * the deps pass through unchanged.
 */
function withRunSecretCapture(
  deps: DispatchDeps,
  runId: string,
): DispatchDeps {
  if (
    !deps.secretRegistry ||
    !deps.secretResolverRefId ||
    !deps.connectionStoreRefId
  ) {
    return deps;
  }
  return {
    ...deps,
    getService: wrapGetServiceForRun({
      getService: deps.getService,
      runId,
      registry: deps.secretRegistry,
      resolverRefId: deps.secretResolverRefId,
      connectionStoreRefId: deps.connectionStoreRefId,
    }),
  };
}

/** Name of the durable queue we use for crash-safe delays. */
export const DELAY_QUEUE_NAME = "automation-delay";

/**
 * Job payload for a delay-resume queue message. The queue's `startDelay`
 * carries the timing; the payload tells the consumer which run to wake.
 */
export interface DelayResumeJob {
  runId: string;
  waitLockId: string;
}

/** Name of the durable queue we use for `wait_until` condition re-checks. */
export const WAIT_UNTIL_QUEUE_NAME = "automation-wait-until";

/**
 * Job payload for a `wait_until` re-check. Each tick re-enriches scope,
 * re-evaluates the condition, and either resumes the run, re-enqueues
 * another tick, or applies the timeout policy.
 */
export interface WaitUntilCheckJob {
  runId: string;
  waitLockId: string;
}

// ─── Public entry points ──────────────────────────────────────────────────

export interface DispatchTriggerArgs {
  automation: LoadedAutomation;
  triggerId: string;
  triggerEventId: string;
  payload: Record<string, unknown>;
  /**
   * Who/what caused the originating event. Persisted as part of the run's
   * scope snapshot and exposed to the automation as `trigger.actor`. Defaults
   * to the system actor when the caller has none.
   */
  actor?: Actor;
  contextKey: string | null;
}

/**
 * Dispatch a fresh trigger event for an automation.
 *
 * 1. Creates the `automation_runs` row
 * 2. Walks `definition.actions` sequentially
 * 3. Persists step state along the way
 * 4. Updates the run status to terminal on completion
 *
 * Returns the assigned `runId` plus the terminal status.
 */
export async function dispatchTrigger(
  deps: DispatchDeps,
  args: DispatchTriggerArgs,
): Promise<{ runId: string; status: string }> {
  const startedAt = new Date();
  const runId = await deps.runStore.createRun({
    automationId: args.automation.id,
    triggerId: args.triggerId,
    triggerEventId: args.triggerEventId,
    triggerPayload: args.payload,
    contextKey: args.contextKey,
  });

  const ctx: DispatchContext = {
    deps: withRunSecretCapture(deps, runId),
    run: {
      runId,
      automation: args.automation,
      triggerId: args.triggerId,
      triggerEventId: args.triggerEventId,
      contextKey: args.contextKey,
      startedAt,
    },
    payload: args.payload,
    scope: buildInitialScope({
      triggerId: args.triggerId,
      triggerEventId: args.triggerEventId,
      payload: args.payload,
      actor: args.actor,
      startedAt,
    }),
    resuming: false,
  };

  // Pre-resolve live health state into scope before any condition or
  // template evaluation (the engine is sync, so this is the only place
  // live state can be fetched). Fail-open inside the helper.
  await enrichScopeWithState({
    scope: ctx.scope,
    client: deps.healthCheckClient,
    logger: deps.logger,
    contextKey: args.contextKey,
    usesState: args.automation.definition.uses_state,
    transitionWindowMinutes: args.automation.definition.state_window_minutes,
  });

  // Initial scope snapshot — gives the stalled sweeper something to
  // work with even if we crash before the first step finishes.
  await deps.runStateStore.upsert({
    runId,
    scopeSnapshot: ctx.scope,
    lastActionPath: null,
  });

  const definition = args.automation.definition;
  const outcome = await walkSequence(
    definition.actions,
    ["actions"],
    ctx,
  );

  return await finaliseRun(ctx, outcome);
}

export interface ResumeRunArgs {
  runId: string;
  automation: LoadedAutomation;
  /**
   * The suspended action's path (the wait_for_trigger or delay action).
   * Walking continues from the next sibling after this position,
   * unwinding nested containers as needed.
   */
  waitedAtPath: string;
  /**
   * Optional payload of the event that satisfied the wait. Exposed to
   * downstream actions as `resume.payload`.
   */
  payload?: Record<string, unknown>;
}

/**
 * Resume a suspended run after a wait_for_trigger or delay satisfies.
 *
 * Loads the persisted scope snapshot, rebuilds the dispatch context,
 * and walks the action tree with a `resumeRemainder` pointing at the
 * suspended action — the walker skips ahead, treats the suspended
 * action as already complete, and continues with its successor.
 *
 * Supports arbitrary nesting through `choose` branches. `parallel` /
 * `repeat` suspensions are rejected (and never persisted in the first
 * place).
 */
export async function resumeRun(
  deps: DispatchDeps,
  args: ResumeRunArgs,
): Promise<{ status: string }> {
  const run = await deps.runStore.loadRun(args.runId);
  if (!run) throw new Error(`Cannot resume — run ${args.runId} not found`);

  // Only a `waiting` run may be resumed. A run that was cancelled (restart
  // mode / operator cancel) or already reached a terminal state must NEVER
  // be resurrected by a late wake (wakeWaitingRuns, delay-expiry sweep, a
  // racing queue job). Drop any stale wait lock for the run and return —
  // mirrors the guard `checkWaitUntil` already applies for `until` locks.
  if (run.status !== "waiting") {
    const stale = await deps.runStore.findWaitLocksByRun(args.runId);
    for (const lock of stale) {
      await deps.runStore.deleteWaitLock(lock.id);
    }
    deps.logger.debug(
      `resumeRun: run ${args.runId} is "${run.status}", not "waiting"; dropped ${stale.length} stale wait lock(s) and skipped resume`,
    );
    return { status: run.status };
  }

  const waitedAt = parseActionPath(args.waitedAtPath);

  // Try to acquire the advisory lock so two resumers don't race.
  const lock = await deps.runStateStore.tryAdvisoryLock(args.runId);
  if (!lock) {
    deps.logger.debug(
      `resumeRun: another instance already holds the lock for run ${args.runId}; skipping`,
    );
    return { status: run.status };
  }

  try {
    const persisted = await deps.runStateStore.load(args.runId);
    const scope = persisted?.scopeSnapshot
      ? { ...persisted.scopeSnapshot }
      : buildInitialScope({
          triggerId: run.triggerId,
          triggerEventId: run.triggerEventId,
          payload: run.triggerPayload,
          startedAt: run.startedAt,
        });
    if (args.payload !== undefined) {
      scope.resume = { payload: args.payload };
    }

    // Re-resolve live state on resume: the system may have changed during
    // the wait, so conditions after a wait must see current state, not
    // the snapshot taken at suspension time.
    await enrichScopeWithState({
      scope,
      client: deps.healthCheckClient,
      logger: deps.logger,
      contextKey: run.contextKey,
      usesState: args.automation.definition.uses_state,
      transitionWindowMinutes: args.automation.definition.state_window_minutes,
    });

    await deps.runStore.updateRunStatus(args.runId, "running");
    await deps.runStateStore.heartbeat(args.runId);

    const ctx: DispatchContext = {
      deps: withRunSecretCapture(deps, args.runId),
      run: {
        runId: args.runId,
        automation: args.automation,
        triggerId: run.triggerId,
        triggerEventId: run.triggerEventId,
        contextKey: run.contextKey,
        startedAt: run.startedAt,
      },
      payload: run.triggerPayload,
      scope,
      resuming: true,
    };

    // Drop the "actions" anchor before forwarding into the walker —
    // we always start a resume at the top-level actions list, so the
    // remainder is the rest of the suspended action's path.
    const remainder = waitedAt.slice(1);
    const outcome = await walkSequence(
      args.automation.definition.actions,
      ["actions"],
      ctx,
      { resumeRemainder: remainder },
    );

    return await finaliseRun(ctx, outcome);
  } finally {
    await lock.release();
  }
}

/**
 * Recover a stalled run. Loads from the durable snapshot, computes the
 * resume target as the next action after the last completed one, and
 * walks. The caller (`stalled-sweeper.ts`) holds the advisory lock for
 * us so a `resumeRun` racing against this one will skip cleanly.
 */
export async function recoverStalledRun(
  deps: DispatchDeps,
  args: { runId: string; automation: LoadedAutomation },
): Promise<{ status: string }> {
  const run = await deps.runStore.loadRun(args.runId);
  if (!run) throw new Error(`recoverStalledRun: run ${args.runId} not found`);
  if (run.status !== "running") {
    // Only genuinely-running runs are recoverable here. A `waiting` run is
    // owned by the wait-lock / queue resume paths; recovering it would
    // re-walk an intentional wait. (The sweeper now filters to `running`,
    // but guard here too so a direct caller can't resurrect a wait.)
    return { status: run.status };
  }

  // A live wait lock means this run is intentionally suspended (a wait the
  // status update may not yet reflect, or a racing path). Refuse rather
  // than from-top re-walk: re-running pre-wait actions has observable side
  // effects. The wait-lock / queue resume paths own this run.
  const existingLocks = await deps.runStore.findWaitLocksByRun(args.runId);
  if (existingLocks.length > 0) {
    deps.logger.debug(
      `recoverStalledRun: run ${args.runId} holds ${existingLocks.length} live wait lock(s); leaving it to the wait/resume paths`,
    );
    return { status: run.status };
  }

  const persisted = await deps.runStateStore.load(args.runId);
  if (!persisted) {
    // No snapshot — give up on this run rather than re-running from
    // scratch (it may have already had observable side effects).
    await deps.runStore.updateRunStatus(
      args.runId,
      "failed",
      "Stalled run had no persisted state; cannot safely recover",
    );
    await deps.runStateStore.clear(args.runId);
    return { status: "failed" };
  }

  await deps.runStore.updateRunStatus(args.runId, "running");
  await deps.runStateStore.heartbeat(args.runId);

  const ctx: DispatchContext = {
    deps: withRunSecretCapture(deps, args.runId),
    run: {
      runId: args.runId,
      automation: args.automation,
      triggerId: run.triggerId,
      triggerEventId: run.triggerEventId,
      contextKey: run.contextKey,
      startedAt: run.startedAt,
    },
    payload: run.triggerPayload,
    scope: { ...persisted.scopeSnapshot },
    resuming: true,
  };

  if (persisted.lastActionPath === null) {
    // Crashed before the first step finished — start from the top.
    const outcome = await walkSequence(
      args.automation.definition.actions,
      ["actions"],
      ctx,
    );
    return await finaliseRun(ctx, outcome);
  }

  const lastDone = parseActionPath(persisted.lastActionPath);
  if (lastDone.includes("parallel")) {
    // Stalled inside a parallel branch without a wait lock means we
    // lost branch concurrency state — we don't know which sibling
    // branches completed (side effects done) versus were still
    // running on the dead host. Rerunning the whole parallel would
    // double-fire completed branches; recovering one branch in
    // isolation would skip incomplete ones. Fail loudly so an
    // operator notices. (Intentional waits inside parallel branches
    // ride the wait-lock resume path, not this one — see
    // `sweepExpiredWaitLocks` and `wakeWaitingRuns`.)
    await deps.runStore.updateRunStatus(
      args.runId,
      "failed",
      `Stalled inside parallel branch at ${persisted.lastActionPath} — branch concurrency state lost; manual recovery required`,
    );
    await deps.runStateStore.clear(args.runId);
    return { status: "failed" };
  }
  // Mid-repeat-iteration stalls are safe: iterations are sequential
  // and the path tells us exactly which iteration's body to resume.

  const remainder = lastDone.slice(1);
  const outcome = await walkSequence(
    args.automation.definition.actions,
    ["actions"],
    ctx,
    { resumeRemainder: remainder },
  );
  return await finaliseRun(ctx, outcome);
}

/**
 * Outcome of a single `wait_until` re-check.
 *   - "resumed"      → condition satisfied (or timed-out-continue); the run
 *                      was resumed past the wait_until.
 *   - "failed"       → timed out with continue_on_timeout=false; run failed.
 *   - "still-waiting"→ not yet true and not timed out; caller re-enqueues.
 *   - "gone"         → lock/run/automation no longer valid; nothing to do.
 */
export type WaitUntilCheckOutcome =
  | "resumed"
  | "failed"
  | "still-waiting"
  | "gone";

/**
 * Re-check a suspended `wait_until`: re-enrich scope, evaluate the
 * condition, and either resume the run (satisfied or timeout-continue),
 * fail it (timeout-fail), or report "still waiting" so the caller
 * re-schedules another check.
 *
 * Read-only until it acts; `resumeRun` takes the per-run advisory lock so
 * a concurrent re-check / sweep can't double-resume. Idempotent: the lock
 * is deleted before resuming, so a duplicate check finds nothing.
 */
export async function checkWaitUntil(
  deps: DispatchDeps,
  args: { runId: string; waitLockId: string; automation: LoadedAutomation },
): Promise<WaitUntilCheckOutcome> {
  const lock = await deps.runStore.loadWaitLock(args.waitLockId);
  if (!lock || lock.kind !== "until" || !lock.waitConfig) return "gone";

  const run = await deps.runStore.loadRun(args.runId);
  if (!run) {
    await deps.runStore.deleteWaitLock(args.waitLockId);
    return "gone";
  }
  if (run.status !== "waiting") {
    // Already resumed / cancelled / terminal — drop the stale lock.
    await deps.runStore.deleteWaitLock(args.waitLockId);
    return "gone";
  }

  // Rebuild the scope from the snapshot + re-enrich live state so the
  // condition sees CURRENT health, not the value at suspension time.
  const persisted = await deps.runStateStore.load(args.runId);
  const scope = persisted?.scopeSnapshot
    ? { ...persisted.scopeSnapshot }
    : buildInitialScope({
        triggerId: run.triggerId,
        triggerEventId: run.triggerEventId,
        payload: run.triggerPayload,
        startedAt: run.startedAt,
      });
  await enrichScopeWithState({
    scope,
    client: deps.healthCheckClient,
    logger: deps.logger,
    contextKey: run.contextKey,
    usesState: args.automation.definition.uses_state,
    transitionWindowMinutes: args.automation.definition.state_window_minutes,
  });

  let satisfied = false;
  try {
    satisfied = evaluateCondition(
      lock.waitConfig.condition,
      scope as TemplateContext,
      deps.filters,
    );
  } catch (error) {
    deps.logger.warn(
      `wait_until re-check threw (treating as not-yet): ${(error as Error).message}`,
    );
  }

  const timedOut =
    lock.timeoutAt !== null && lock.timeoutAt.getTime() <= Date.now();

  if (satisfied || (timedOut && lock.waitConfig.continueOnTimeout)) {
    await deps.runStore.deleteWaitLock(args.waitLockId);
    await resumeRun(deps, {
      runId: args.runId,
      automation: args.automation,
      waitedAtPath: lock.actionPath,
    });
    return "resumed";
  }

  if (timedOut) {
    // continue_on_timeout = false → fail the run.
    await deps.runStore.deleteWaitLock(args.waitLockId);
    await deps.runStore.updateRunStatus(
      args.runId,
      "failed",
      `wait_until timed out after waiting for its condition`,
    );
    await deps.runStateStore.clear(args.runId);
    return "failed";
  }

  return "still-waiting";
}

// ─── Run finalisation ─────────────────────────────────────────────────────

async function finaliseRun(
  ctx: DispatchContext,
  outcome: SequenceOutcome,
): Promise<{ runId: string; status: string }> {
  let status: "success" | "failed" | "waiting";
  let errorMessage: string | undefined;
  switch (outcome.kind) {
    case "completed": {
      status = "success";
      break;
    }
    case "stopped": {
      status = outcome.error ? "failed" : "success";
      errorMessage = outcome.reason;
      break;
    }
    case "suspended": {
      status = "waiting";
      break;
    }
  }
  await ctx.deps.runStore.updateRunStatus(
    ctx.run.runId,
    status,
    errorMessage,
  );
  // Terminal runs drop their durable state. Suspended runs keep it so
  // resumption has the scope to work with — but we must NOT clobber
  // `lastActionPath`: the suspending action already checkpointed its real
  // path, and a crash recovery needs that to resume from the wait rather
  // than re-walking from actions[0] (which would re-fire pre-wait side
  // effects). Omit it so the existing checkpoint survives.
  await (status === "waiting" ? ctx.deps.runStateStore.upsert({
      runId: ctx.run.runId,
      scopeSnapshot: ctx.scope,
    }) : ctx.deps.runStateStore.clear(ctx.run.runId));
  return { runId: ctx.run.runId, status };
}

// ─── Sequence walker ──────────────────────────────────────────────────────

interface WalkOptions {
  /**
   * When set, walking starts in resume mode. The first segment of
   * `resumeRemainder` is an index into the sequence we should skip
   * ahead to. After processing the resume target, walking continues
   * normally.
   */
  resumeRemainder?: ActionPath;
}

async function walkSequence(
  actions: ReadonlyArray<Action>,
  basePath: ActionPath,
  ctx: DispatchContext,
  options: WalkOptions = {},
): Promise<SequenceOutcome> {
  const remainder = options.resumeRemainder;

  if (remainder !== undefined) {
    if (remainder.length === 0) {
      // Caller targeted this exact sequence's slot. Nothing more to
      // skip; walk everything normally.
      return await walkSequence(actions, basePath, ctx);
    }
    const targetIndex = remainder[0];
    if (typeof targetIndex !== "number") {
      throw new TypeError(
        `Resume path corrupt at ${basePath.join(".")}: expected numeric index, got ${String(
          targetIndex,
        )}`,
      );
    }

    for (const [i, action] of actions.entries()) {
      if (i < targetIndex) continue;
      const path: ActionPath = [...basePath, i];

      if (i === targetIndex) {
        if (remainder.length === 1) {
          // The action at this index is the suspended one. It already
          // ran; mark a synthetic step note (operators see it as
          // "resumed") and move past.
          ctx.deps.logger.debug(
            `Resume target reached at ${formatActionPath(path)} — continuing past`,
          );
          continue;
        }
        // Descend into the container at this index with the deeper
        // remainder so the choose handler (etc.) can route correctly.
        const outcome = await executeAction(action, path, ctx, {
          resumeRemainder: remainder.slice(1),
        });
        const propagated = propagate(outcome, action.continue_on_error, ctx, path);
        if (propagated.terminal) return propagated.terminal;
        continue;
      }

      // After the resume target we walk normally — no more remainder.
      const outcome = await executeAction(action, path, ctx);
      const propagated = propagate(outcome, action.continue_on_error, ctx, path);
      if (propagated.terminal) return propagated.terminal;
    }
    return { kind: "completed" };
  }

  for (const [i, action] of actions.entries()) {
    const path: ActionPath = [...basePath, i];
    const outcome = await executeAction(action, path, ctx);
    const propagated = propagate(outcome, action.continue_on_error, ctx, path);
    if (propagated.terminal) return propagated.terminal;
  }
  return { kind: "completed" };
}

/**
 * Project a single step's outcome onto the enclosing sequence's
 * outcome. Returns `{ terminal: undefined }` to mean "keep walking".
 */
function propagate(
  outcome: StepOutcome,
  continueOnError: boolean | undefined,
  ctx: DispatchContext,
  path: ActionPath,
): { terminal?: SequenceOutcome } {
  if (outcome.kind === "stopped") {
    return { terminal: outcome };
  }
  if (outcome.kind === "failed") {
    if (continueOnError) {
      ctx.deps.logger.warn(
        `Action ${formatActionPath(path)} failed but continue_on_error=true: ${outcome.error}`,
      );
      return {};
    }
    return {
      terminal: { kind: "stopped", reason: outcome.error, error: true },
    };
  }
  if (outcome.kind === "suspended") {
    return {
      terminal: { kind: "suspended", suspendingStepId: outcome.stepId },
    };
  }
  return {};
}

// ─── Action dispatch (per kind) ───────────────────────────────────────────

interface ExecuteOptions {
  /** Forwarded into container actions during resume. */
  resumeRemainder?: ActionPath;
}

async function executeAction(
  action: Action,
  path: ActionPath,
  ctx: DispatchContext,
  options: ExecuteOptions = {},
): Promise<StepOutcome> {
  const kind = detectActionKind(action);

  // `enabled: false` → record a skip, no work.
  if (action.enabled === false) {
    await recordSkipStep(ctx, path, action, kind, "disabled");
    return { kind: "skipped", reason: "disabled" };
  }

  switch (kind) {
    case "action": {
      return await executeProviderAction(action as ProviderAction, path, ctx);
    }
    case "choose": {
      return await executeChoose(
        action as ChooseInput,
        path,
        ctx,
        options.resumeRemainder,
      );
    }
    case "parallel": {
      return await executeParallel(
        action as ParallelInput,
        path,
        ctx,
        options.resumeRemainder,
      );
    }
    case "delay": {
      return await executeDelay(action as DelayInput, path, ctx);
    }
    case "repeat": {
      return await executeRepeat(
        action as RepeatInput,
        path,
        ctx,
        options.resumeRemainder,
      );
    }
    case "variables": {
      return await executeVariables(action as VariablesInput, path, ctx);
    }
    case "condition": {
      return await executeConditionGuard(action as ConditionGuardInput, path, ctx);
    }
    case "stop": {
      return await executeStop(action as StopInput, path, ctx);
    }
    case "wait_for_trigger": {
      return await executeWaitForTrigger(
        action as WaitForTriggerInput,
        path,
        ctx,
      );
    }
    case "wait_until": {
      return await executeWaitUntil(action as WaitUntilInput, path, ctx);
    }
    case "sequence": {
      return await executeSequence(
        action as SequenceInput,
        path,
        ctx,
        options.resumeRemainder,
      );
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function templateContext(ctx: DispatchContext): TemplateContext {
  return ctx.scope as TemplateContext;
}

/**
 * Project the dispatch scope into the {@link ActionRunScope} handed to an
 * action's `execute`. The internal `variables` key is normalised to the
 * public contract name `vars`, and the trigger identity (`id`, `event`,
 * `actor`) is projected so scripts can branch on which trigger fired and who
 * caused it.
 */
function actionRunScope(ctx: DispatchContext): ActionRunScope {
  const scope = ctx.scope as {
    trigger?: {
      id?: unknown;
      event?: unknown;
      eventId?: unknown;
      actor?: unknown;
      payload?: unknown;
    };
    artifacts?: unknown;
    variables?: unknown;
    repeat?: { index?: unknown; item?: unknown };
  };
  const trigger = scope.trigger;
  // `event` is canonical; fall back to the legacy `eventId` alias for older
  // scope snapshots persisted before the rename.
  const event =
    typeof trigger?.event === "string"
      ? trigger.event
      : typeof trigger?.eventId === "string"
        ? trigger.eventId
        : "";
  const result: ActionRunScope = {
    trigger: {
      id: typeof trigger?.id === "string" ? trigger.id : "",
      event,
      actor: isActor(trigger?.actor) ? trigger.actor : SYSTEM_ACTOR,
      payload: coerceRecord(trigger?.payload),
    },
    artifacts: coerceRecord(scope.artifacts),
    vars: coerceRecord(scope.variables),
  };
  if (scope.repeat && typeof scope.repeat.index === "number") {
    result.repeat = { index: scope.repeat.index, item: scope.repeat.item };
  }
  return result;
}

/** Narrow an unknown scope value to a string-keyed record (else `{}`). */
function coerceRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Structural check that a scope value is a usable {@link Actor}. */
function isActor(value: unknown): value is Actor {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.type === "string" && typeof candidate.id === "string"
  );
}

async function recordSkipStep(
  ctx: DispatchContext,
  path: ActionPath,
  action: Action,
  kind: ActionKind,
  reason: string,
): Promise<void> {
  const stepId = await ctx.deps.runStore.createStep({
    runId: ctx.run.runId,
    actionPath: formatActionPath(path),
    actionId: action.id ?? null,
    actionKind: kind,
    providerActionId:
      kind === "action" ? (action as ProviderAction).action : null,
  });
  await ctx.deps.runStore.updateStep(stepId, {
    status: "skipped",
    errorMessage: reason,
  });
}

/**
 * Persist a scope snapshot + heartbeat after a step completes. Called
 * after every successful or terminal-non-failure outcome so the stalled
 * sweeper can resume cleanly.
 */
async function checkpoint(
  ctx: DispatchContext,
  lastDonePath: ActionPath,
): Promise<void> {
  await ctx.deps.runStateStore.upsert({
    runId: ctx.run.runId,
    scopeSnapshot: ctx.scope,
    lastActionPath: formatActionPath(lastDonePath),
  });
}

// ─── Primitive: `action` (provider call) ─────────────────────────────────

async function executeProviderAction(
  action: ProviderAction,
  path: ActionPath,
  ctx: DispatchContext,
): Promise<StepOutcome> {
  const registry = ctx.deps.registries.actions;
  const registered = registry.getAction(action.action);

  const stepId = await ctx.deps.runStore.createStep({
    runId: ctx.run.runId,
    actionPath: formatActionPath(path),
    actionId: action.id ?? null,
    actionKind: "action",
    providerActionId: action.action,
  });

  if (!registered) {
    const error = `Unknown action "${action.action}" — not registered by any plugin.`;
    await ctx.deps.runStore.updateStep(stepId, {
      status: "failed",
      errorMessage: error,
    });
    return { kind: "failed", error };
  }

  let renderedConfig: unknown;
  try {
    renderedConfig = renderConfig({
      config: action.config,
      jsonSchema: registered.configJsonSchema,
      context: templateContext(ctx),
      filters: ctx.deps.filters,
    });
  } catch (error) {
    const message = `Failed to render config: ${(error as Error).message}`;
    await ctx.deps.runStore.updateStep(stepId, {
      status: "failed",
      errorMessage: message,
    });
    return { kind: "failed", error: message };
  }

  const parsed = registered.config.schema.safeParse(renderedConfig);
  if (!parsed.success) {
    const message = `Config validation failed: ${parsed.error.message}`;
    await ctx.deps.runStore.updateStep(stepId, {
      status: "failed",
      errorMessage: message,
    });
    return { kind: "failed", error: message };
  }

  const consumed = await resolveConsumedArtifacts(
    ctx,
    registered.consumes ?? [],
    registered.ownerPluginId,
  );

  let result: Awaited<ReturnType<typeof registered.execute>>;
  try {
    result = await registered.execute({
      config: parsed.data,
      consumedArtifacts: consumed,
      scope: actionRunScope(ctx),
      runId: ctx.run.runId,
      automationId: ctx.run.automation.id,
      contextKey: ctx.run.contextKey,
      logger: ctx.deps.logger,
      getService: ctx.deps.getService,
    });
  } catch (error) {
    const message = (error as Error).message;
    await ctx.deps.runStore.updateStep(stepId, {
      status: "failed",
      errorMessage: message,
    });
    return { kind: "failed", error: message };
  }

  if (!result.success) {
    const message = result.error ?? "action returned success=false";
    await ctx.deps.runStore.updateStep(stepId, {
      status: "failed",
      errorMessage: message,
    });
    return { kind: "failed", error: message };
  }

  if (registered.produces && result.artifact !== undefined) {
    // Producers MUST have an id (enforced by validate-definition). Guard
    // defensively so a malformed definition fails loud rather than via a
    // non-null assertion.
    if (!action.id) {
      const message = `Action "${action.action}" produces an artifact but has no id; it cannot be referenced as artifacts.<id>.<name>`;
      await ctx.deps.runStore.updateStep(stepId, {
        status: "failed",
        errorMessage: message,
      });
      return { kind: "failed", error: message };
    }
    await ctx.deps.artifactStore.record({
      automationId: ctx.run.automation.id,
      runId: ctx.run.runId,
      stepId,
      actionId: action.id,
      artifactType: registered.produces,
      data: result.artifact as Record<string, unknown>,
      contextKey: ctx.run.contextKey,
    });
    // The local artifact name is `produces` with the owning plugin prefix
    // stripped (e.g. `integration-jira.issue` → `issue`). Falls back to the
    // full `produces` if it somehow lacks the expected prefix.
    const prefix = `${registered.ownerPluginId}.`;
    const localName = registered.produces.startsWith(prefix)
      ? registered.produces.slice(prefix.length)
      : registered.produces;
    const existingArtifacts =
      (ctx.scope.artifacts as Record<string, unknown>) ?? {};
    const existingForAction = existingArtifacts[action.id];
    const nestedForAction =
      existingForAction !== null &&
      typeof existingForAction === "object" &&
      !Array.isArray(existingForAction)
        ? (existingForAction as Record<string, unknown>)
        : {};
    ctx.scope.artifacts = {
      ...existingArtifacts,
      [action.id]: { ...nestedForAction, [localName]: result.artifact },
    };
  }

  await ctx.deps.runStore.updateStep(stepId, {
    status: "success",
    resultPayload: { externalId: result.externalId },
  });
  await checkpoint(ctx, path);
  return { kind: "ok" };
}

// ─── Primitive: `choose` ─────────────────────────────────────────────────

async function executeChoose(
  action: ChooseInput,
  path: ActionPath,
  ctx: DispatchContext,
  resumeRemainder?: ActionPath,
): Promise<StepOutcome> {
  const stepId = await ctx.deps.runStore.createStep({
    runId: ctx.run.runId,
    actionPath: formatActionPath(path),
    actionId: action.id ?? null,
    actionKind: "choose",
    providerActionId: null,
  });

  // Resume path inside a choose looks like ["choose", branchIdx, "sequence", ...].
  if (resumeRemainder !== undefined && resumeRemainder.length > 0) {
    if (resumeRemainder[0] !== "choose") {
      throw new Error(
        `Resume path corrupt at ${formatActionPath(path)}: expected "choose", got ${String(
          resumeRemainder[0],
        )}`,
      );
    }
    const branchIdx = resumeRemainder[1];
    if (typeof branchIdx !== "number") {
      throw new TypeError(
        `Resume path corrupt at ${formatActionPath(path)}: expected branch index`,
      );
    }
    if (resumeRemainder[2] !== "sequence") {
      throw new Error(
        `Resume path corrupt at ${formatActionPath(path)}: expected "sequence", got ${String(
          resumeRemainder[2],
        )}`,
      );
    }
    const inner = resumeRemainder.slice(3);
    const branch = action.choose[branchIdx];
    if (!branch) {
      const message = `Resume target choose[${branchIdx}] no longer exists in this automation definition`;
      await ctx.deps.runStore.updateStep(stepId, {
        status: "failed",
        errorMessage: message,
      });
      return { kind: "failed", error: message };
    }
    const outcome = await walkSequence(
      branch.sequence,
      [...path, "choose", branchIdx, "sequence"],
      ctx,
      { resumeRemainder: inner },
    );
    await ctx.deps.runStore.updateStep(stepId, {
      status: outcome.kind === "completed" ? "success" : "failed",
      resultPayload: { resumedBranch: branchIdx },
      errorMessage: outcome.kind === "stopped" ? outcome.reason : undefined,
    });
    if (outcome.kind === "completed") await checkpoint(ctx, path);
    return sequenceToStep(outcome);
  }

  // Normal first-time execution: evaluate `when`s in order.
  for (const [i, branch] of action.choose.entries()) {
    let take: boolean;
    try {
      take = evaluateCondition(
        branch.when,
        templateContext(ctx),
        ctx.deps.filters,
      );
    } catch (error) {
      const message = `Failed to evaluate choose[${i}].when: ${(error as Error).message}`;
      await ctx.deps.runStore.updateStep(stepId, {
        status: "failed",
        errorMessage: message,
      });
      return { kind: "failed", error: message };
    }
    if (take) {
      const outcome = await walkSequence(
        branch.sequence,
        [...path, "choose", i, "sequence"],
        ctx,
      );
      await ctx.deps.runStore.updateStep(stepId, {
        status: outcome.kind === "completed" ? "success" : "failed",
        resultPayload: { matchedBranch: i },
        errorMessage:
          outcome.kind === "stopped" ? outcome.reason : undefined,
      });
      if (outcome.kind === "completed") await checkpoint(ctx, path);
      return sequenceToStep(outcome);
    }
  }

  if (action.else && action.else.length > 0) {
    const outcome = await walkSequence(
      action.else,
      [...path, "else"],
      ctx,
    );
    await ctx.deps.runStore.updateStep(stepId, {
      status: outcome.kind === "completed" ? "success" : "failed",
      resultPayload: { matchedBranch: "else" },
      errorMessage: outcome.kind === "stopped" ? outcome.reason : undefined,
    });
    if (outcome.kind === "completed") await checkpoint(ctx, path);
    return sequenceToStep(outcome);
  }

  await ctx.deps.runStore.updateStep(stepId, {
    status: "success",
    resultPayload: { matchedBranch: null },
  });
  await checkpoint(ctx, path);
  return { kind: "ok" };
}

// ─── Primitive: `parallel` ───────────────────────────────────────────────

/**
 * Per-branch terminal outcome shape persisted in the parallel step's
 * `result_payload.branchOutcomes`. Resumption reads this to know which
 * branches still need work and which have already completed (or
 * failed) — so resuming one branch doesn't re-execute the others.
 */
interface StoredBranchOutcome {
  status: "completed" | "stopped" | "failed" | "suspended";
  reason?: string;
  error?: boolean;
}

function outcomeToStored(outcome: SequenceOutcome): StoredBranchOutcome {
  if (outcome.kind === "completed") return { status: "completed" };
  if (outcome.kind === "suspended") return { status: "suspended" };
  return {
    status: outcome.error ? "failed" : "stopped",
    reason: outcome.reason,
    error: outcome.error,
  };
}

async function executeParallel(
  action: ParallelInput,
  path: ActionPath,
  ctx: DispatchContext,
  resumeRemainder?: ActionPath,
): Promise<StepOutcome> {
  if (resumeRemainder !== undefined && resumeRemainder.length > 0) {
    return await resumeParallel(action, path, ctx, resumeRemainder);
  }

  const stepId = await ctx.deps.runStore.createStep({
    runId: ctx.run.runId,
    actionPath: formatActionPath(path),
    actionId: action.id ?? null,
    actionKind: "parallel",
    providerActionId: null,
  });

  // Walk every branch concurrently. Promise.all resolves when each
  // branch has reached a terminal outcome (completed / failed / stopped
  // / suspended). A branch reaching "suspended" means its inner
  // wait_for_trigger or delay wrote a wait-lock — the parallel keeps
  // the rest of the branch outcomes around and itself suspends.
  const promises = action.parallel.map(async (a, i) =>
    walkSequence([a], [...path, "parallel", i], ctx),
  );
  const outcomes = await Promise.all(promises);

  const branchOutcomes: Record<string, StoredBranchOutcome> = {};
  for (const [i, o] of outcomes.entries()) {
    branchOutcomes[String(i)] = outcomeToStored(o);
  }
  await ctx.deps.runStore.updateStep(stepId, {
    status: outcomes.some((o) => o.kind === "suspended") ? "waiting" : "running",
    resultPayload: { branchOutcomes },
  });
  return await finaliseParallel(action, ctx, stepId, branchOutcomes, path);
}

async function resumeParallel(
  action: ParallelInput,
  path: ActionPath,
  ctx: DispatchContext,
  resumeRemainder: ActionPath,
): Promise<StepOutcome> {
  if (resumeRemainder[0] !== "parallel") {
    throw new Error(
      `Resume path corrupt at ${formatActionPath(path)}: expected "parallel", got ${String(
        resumeRemainder[0],
      )}`,
    );
  }
  const branchIdx = resumeRemainder[1];
  if (typeof branchIdx !== "number") {
    throw new TypeError(
      `Resume path corrupt at ${formatActionPath(path)}: expected numeric branch index`,
    );
  }
  const inner = resumeRemainder.slice(2);

  const branch = action.parallel[branchIdx];
  if (!branch) {
    const message = `Resume target parallel[${branchIdx}] no longer exists in this automation definition`;
    const stepId = await ctx.deps.runStore.createStep({
      runId: ctx.run.runId,
      actionPath: formatActionPath(path),
      actionId: action.id ?? null,
      actionKind: "parallel",
      providerActionId: null,
    });
    await ctx.deps.runStore.updateStep(stepId, {
      status: "failed",
      errorMessage: message,
    });
    return { kind: "failed", error: message };
  }

  const existing = await ctx.deps.runStore.findStepByPath(
    ctx.run.runId,
    formatActionPath(path),
  );
  if (!existing) {
    const message = `Cannot resume parallel at ${formatActionPath(path)} — original step record missing`;
    return { kind: "failed", error: message };
  }
  const stepId = existing.id;
  const branchOutcomes: Record<string, StoredBranchOutcome> = {
    ...(existing.resultPayload?.branchOutcomes as
      | Record<string, StoredBranchOutcome>
      | undefined),
  };

  // Walk only the suspended branch. The walker enters resume mode for
  // exactly this branch; other branches' side effects already happened
  // before the original suspension and must not re-execute.
  const outcome = await walkSequence(
    [branch],
    [...path, "parallel", branchIdx],
    ctx,
    { resumeRemainder: inner },
  );
  branchOutcomes[String(branchIdx)] = outcomeToStored(outcome);
  await ctx.deps.runStore.updateStep(stepId, {
    status: Object.values(branchOutcomes).some(
      (o) => o.status === "suspended",
    )
      ? "waiting"
      : "running",
    resultPayload: { branchOutcomes },
  });

  return await finaliseParallel(action, ctx, stepId, branchOutcomes, path);
}

/**
 * Aggregate the per-branch outcome map into a single step outcome.
 * Any still-suspended branch means the parallel itself stays
 * suspended; any failure (without `continue_on_error`) fails it; else
 * it completes.
 */
async function finaliseParallel(
  action: ParallelInput,
  ctx: DispatchContext,
  stepId: string,
  branchOutcomes: Record<string, StoredBranchOutcome>,
  path: ActionPath,
): Promise<StepOutcome> {
  const stillSuspended = action.parallel.some(
    (_, i) => branchOutcomes[String(i)]?.status === "suspended",
  );
  if (stillSuspended) {
    return { kind: "suspended", stepId };
  }

  const failures = action.parallel
    .map((_, i) => branchOutcomes[String(i)])
    .filter((o): o is StoredBranchOutcome => o !== undefined)
    .filter((o) => o.status === "failed");
  if (failures.length > 0 && !action.continue_on_error) {
    const reason = failures[0]!.reason;
    await ctx.deps.runStore.updateStep(stepId, {
      status: "failed",
      errorMessage: reason,
    });
    return { kind: "failed", error: reason ?? "parallel branch failed" };
  }

  await ctx.deps.runStore.updateStep(stepId, { status: "success" });
  await checkpoint(ctx, path);
  return { kind: "ok" };
}

// ─── Primitive: `delay` (queue-backed) ───────────────────────────────────

async function executeDelay(
  action: DelayInput,
  path: ActionPath,
  ctx: DispatchContext,
): Promise<StepOutcome> {
  const stepId = await ctx.deps.runStore.createStep({
    runId: ctx.run.runId,
    actionPath: formatActionPath(path),
    actionId: action.id ?? null,
    actionKind: "delay",
    providerActionId: null,
  });

  let seconds: number;
  if ("seconds" in action.delay) {
    seconds = action.delay.seconds;
  } else {
    const rendered = renderExpression(
      action.delay.template,
      templateContext(ctx),
      ctx.deps.filters,
    );
    const n = typeof rendered === "number" ? rendered : Number(rendered);
    if (!Number.isFinite(n) || n < 0) {
      const message = `delay template evaluated to invalid duration: ${String(rendered)}`;
      await ctx.deps.runStore.updateStep(stepId, {
        status: "failed",
        errorMessage: message,
      });
      return { kind: "failed", error: message };
    }
    seconds = Math.floor(n);
  }

  const timeoutAt = new Date(Date.now() + seconds * 1000);
  const waitLockId = await ctx.deps.runStore.createWaitLock({
    runId: ctx.run.runId,
    actionPath: formatActionPath(path),
    kind: "delay",
    eventId: `@@delay:${ctx.run.runId}:${formatActionPath(path)}`,
    contextKey: null,
    filterTemplate: null,
    timeoutAt,
  });

  // Persist scope BEFORE we suspend so a sweeper / queue resume can
  // load it without racing the step write below.
  await checkpoint(ctx, path);

  const queue = ctx.deps.queueManager.getQueue<DelayResumeJob>(DELAY_QUEUE_NAME);
  await queue.enqueue(
    { runId: ctx.run.runId, waitLockId },
    { startDelay: seconds, jobId: `${ctx.run.runId}:${waitLockId}` },
  );

  await ctx.deps.runStore.updateStep(stepId, {
    status: "waiting",
    resultPayload: { sleepSeconds: seconds, waitLockId, queueBacked: true },
  });
  return { kind: "suspended", stepId };
}

// ─── Primitive: `repeat` ─────────────────────────────────────────────────

const DEFAULT_MAX_ITERATIONS = 1000;

async function executeRepeat(
  action: RepeatInput,
  path: ActionPath,
  ctx: DispatchContext,
  resumeRemainder?: ActionPath,
): Promise<StepOutcome> {
  // Resume path: walk the suspended iteration first, then continue
  // with the remaining iterations per the loop mode.
  if (resumeRemainder !== undefined && resumeRemainder.length > 0) {
    return await resumeRepeat(action, path, ctx, resumeRemainder);
  }

  const stepId = await ctx.deps.runStore.createStep({
    runId: ctx.run.runId,
    actionPath: formatActionPath(path),
    actionId: action.id ?? null,
    actionKind: "repeat",
    providerActionId: null,
  });

  // For for_each: cache the list on the step so a resume sees the
  // same iteration order even if downstream actions mutated the
  // expression source.
  let forEachList: unknown[] | undefined;
  if ("for_each" in action.repeat) {
    const evaluated = renderExpression(
      action.repeat.for_each,
      templateContext(ctx),
      ctx.deps.filters,
    );
    if (!Array.isArray(evaluated)) {
      const message = `repeat.for_each expression did not evaluate to an array: ${String(evaluated)}`;
      await ctx.deps.runStore.updateStep(stepId, {
        status: "failed",
        errorMessage: message,
      });
      return { kind: "failed", error: message };
    }
    forEachList = evaluated;
    await ctx.deps.runStore.updateStep(stepId, {
      status: "running",
      resultPayload: { forEachList },
    });
  }

  return await runRepeatLoop(action, path, ctx, stepId, 0, forEachList);
}

async function resumeRepeat(
  action: RepeatInput,
  path: ActionPath,
  ctx: DispatchContext,
  resumeRemainder: ActionPath,
): Promise<StepOutcome> {
  if (resumeRemainder[0] !== "repeat") {
    throw new Error(
      `Resume path corrupt at ${formatActionPath(path)}: expected "repeat", got ${String(
        resumeRemainder[0],
      )}`,
    );
  }
  const iterIdx = resumeRemainder[1];
  if (typeof iterIdx !== "number") {
    throw new TypeError(
      `Resume path corrupt at ${formatActionPath(path)}: expected numeric iteration index`,
    );
  }
  if (resumeRemainder[2] !== "sequence") {
    throw new Error(
      `Resume path corrupt at ${formatActionPath(path)}: expected "sequence", got ${String(
        resumeRemainder[2],
      )}`,
    );
  }
  const inner = resumeRemainder.slice(3);

  const existing = await ctx.deps.runStore.findStepByPath(
    ctx.run.runId,
    formatActionPath(path),
  );
  if (!existing) {
    return {
      kind: "failed",
      error: `Cannot resume repeat at ${formatActionPath(path)} — original step record missing`,
    };
  }
  const stepId = existing.id;
  const forEachList =
    (existing.resultPayload?.forEachList as unknown[] | undefined) ??
    undefined;

  // Build the iteration-N child scope (matches the original execution
  // so repeat.item / repeat.index resolve correctly during the
  // resumed sequence walk).
  const item =
    forEachList === undefined ? undefined : forEachList[iterIdx];
  const childScope = withRepeatContext(ctx.scope, {
    index: iterIdx,
    ...(item === undefined ? {} : { item }),
  });
  const childCtx = { ...ctx, scope: childScope };

  const iterOutcome = await walkSequence(
    action.repeat.sequence,
    [...path, "repeat", iterIdx, "sequence"],
    childCtx,
    { resumeRemainder: inner },
  );
  if (iterOutcome.kind !== "completed") {
    // Iteration didn't finish — propagate (suspended re-suspends the
    // repeat, stopped/failed terminates the loop).
    await ctx.deps.runStore.updateStep(stepId, {
      status: iterOutcome.kind === "suspended" ? "waiting" : "failed",
      resultPayload: { iterations: iterIdx, forEachList },
      errorMessage:
        iterOutcome.kind === "stopped" ? iterOutcome.reason : undefined,
    });
    return sequenceToStep(iterOutcome);
  }

  // Continue the loop from the next iteration.
  return await runRepeatLoop(action, path, ctx, stepId, iterIdx + 1, forEachList);
}

/**
 * Drive iterations from `startIter` forward. Used by both fresh
 * execution (start = 0) and resume (start = N+1 after iteration N
 * resumes to completion).
 */
async function runRepeatLoop(
  action: RepeatInput,
  path: ActionPath,
  ctx: DispatchContext,
  stepId: string,
  startIter: number,
  forEachList: unknown[] | undefined,
): Promise<StepOutcome> {
  const repeat = action.repeat;
  let iterationsRun = startIter;
  let outcome: SequenceOutcome = { kind: "completed" };

  if ("count" in repeat) {
    for (let i = startIter; i < repeat.count; i += 1) {
      const childScope = withRepeatContext(ctx.scope, { index: i });
      outcome = await walkSequence(
        repeat.sequence,
        [...path, "repeat", i, "sequence"],
        { ...ctx, scope: childScope },
      );
      iterationsRun = i + 1;
      if (outcome.kind !== "completed") break;
    }
  } else if ("for_each" in repeat) {
    if (!forEachList) {
      // Should never happen — fresh execution and resume both set this
      // — but guard so we fail loud instead of silently iterating zero.
      const message = `repeat at ${formatActionPath(path)} resumed without a cached for_each list`;
      await ctx.deps.runStore.updateStep(stepId, {
        status: "failed",
        errorMessage: message,
      });
      return { kind: "failed", error: message };
    }
    for (let i = startIter; i < forEachList.length; i += 1) {
      const childScope = withRepeatContext(ctx.scope, {
        index: i,
        item: forEachList[i],
      });
      outcome = await walkSequence(
        repeat.sequence,
        [...path, "repeat", i, "sequence"],
        { ...ctx, scope: childScope },
      );
      iterationsRun = i + 1;
      if (outcome.kind !== "completed") break;
    }
  } else if ("while" in repeat) {
    const max = repeat.max_iterations ?? DEFAULT_MAX_ITERATIONS;
    let i = startIter;
    while (i < max) {
      const childScope = withRepeatContext(ctx.scope, { index: i });
      const childCtx = { ...ctx, scope: childScope };
      let cond: boolean;
      try {
        cond = evaluateCondition(
          repeat.while,
          templateContext(childCtx),
          ctx.deps.filters,
        );
      } catch {
        cond = false;
      }
      if (!cond) break;
      outcome = await walkSequence(
        repeat.sequence,
        [...path, "repeat", i, "sequence"],
        childCtx,
      );
      i += 1;
      iterationsRun = i;
      if (outcome.kind !== "completed") break;
    }
  } else {
    const max = repeat.max_iterations ?? DEFAULT_MAX_ITERATIONS;
    let i = startIter;
    while (i < max) {
      const childScope = withRepeatContext(ctx.scope, { index: i });
      const childCtx = { ...ctx, scope: childScope };
      outcome = await walkSequence(
        repeat.sequence,
        [...path, "repeat", i, "sequence"],
        childCtx,
      );
      i += 1;
      iterationsRun = i;
      if (outcome.kind !== "completed") break;
      let done: boolean;
      try {
        done = evaluateCondition(
          repeat.until,
          templateContext(childCtx),
          ctx.deps.filters,
        );
      } catch {
        done = false;
      }
      if (done) break;
    }
  }

  await ctx.deps.runStore.updateStep(stepId, {
    status:
      outcome.kind === "completed"
        ? "success"
        : outcome.kind === "suspended"
          ? "waiting"
          : "failed",
    resultPayload: { iterations: iterationsRun, forEachList },
    errorMessage: outcome.kind === "stopped" ? outcome.reason : undefined,
  });
  if (outcome.kind === "completed") await checkpoint(ctx, path);
  return sequenceToStep(outcome);
}

// ─── Primitive: `variables` ───────────────────────────────────────────────

async function executeVariables(
  action: VariablesInput,
  path: ActionPath,
  ctx: DispatchContext,
): Promise<StepOutcome> {
  const stepId = await ctx.deps.runStore.createStep({
    runId: ctx.run.runId,
    actionPath: formatActionPath(path),
    actionId: action.id ?? null,
    actionKind: "variables",
    providerActionId: null,
  });

  const rendered: Record<string, unknown> = {};
  try {
    for (const [k, v] of Object.entries(action.variables)) {
      rendered[k] =
        typeof v === "string"
          ? renderString(v, templateContext(ctx), ctx.deps.filters)
          : renderValue(v, templateContext(ctx), ctx.deps.filters);
    }
  } catch (error) {
    const message = `Failed to render variables: ${(error as Error).message}`;
    await ctx.deps.runStore.updateStep(stepId, {
      status: "failed",
      errorMessage: message,
    });
    return { kind: "failed", error: message };
  }

  ctx.scope = extendVariables(ctx.scope, rendered);
  await ctx.deps.runStore.updateStep(stepId, {
    status: "success",
    resultPayload: { defined: Object.keys(rendered) },
  });
  await checkpoint(ctx, path);
  return { kind: "ok" };
}

// ─── Primitive: `condition` (guard) ──────────────────────────────────────

async function executeConditionGuard(
  action: ConditionGuardInput,
  path: ActionPath,
  ctx: DispatchContext,
): Promise<StepOutcome> {
  const stepId = await ctx.deps.runStore.createStep({
    runId: ctx.run.runId,
    actionPath: formatActionPath(path),
    actionId: action.id ?? null,
    actionKind: "condition",
    providerActionId: null,
  });

  let pass: boolean;
  try {
    pass = evaluateCondition(
      action.condition,
      templateContext(ctx),
      ctx.deps.filters,
    );
  } catch (error) {
    const message = `Failed to evaluate condition: ${(error as Error).message}`;
    await ctx.deps.runStore.updateStep(stepId, {
      status: "failed",
      errorMessage: message,
    });
    return { kind: "failed", error: message };
  }

  if (pass) {
    await ctx.deps.runStore.updateStep(stepId, { status: "success" });
    await checkpoint(ctx, path);
    return { kind: "ok" };
  }
  await ctx.deps.runStore.updateStep(stepId, {
    status: "failed",
    errorMessage: "condition gate failed",
  });
  return { kind: "stopped", reason: "condition gate failed", error: false };
}

// ─── Primitive: `stop` ───────────────────────────────────────────────────

async function executeStop(
  action: StopInput,
  path: ActionPath,
  ctx: DispatchContext,
): Promise<StepOutcome> {
  const stepId = await ctx.deps.runStore.createStep({
    runId: ctx.run.runId,
    actionPath: formatActionPath(path),
    actionId: action.id ?? null,
    actionKind: "stop",
    providerActionId: null,
  });
  await ctx.deps.runStore.updateStep(stepId, {
    status: "success",
    resultPayload: { reason: action.stop.reason, error: action.stop.error },
  });
  return {
    kind: "stopped",
    reason: action.stop.reason,
    error: action.stop.error,
  };
}

// ─── Primitive: `wait_for_trigger` ───────────────────────────────────────

async function executeWaitForTrigger(
  action: WaitForTriggerInput,
  path: ActionPath,
  ctx: DispatchContext,
): Promise<StepOutcome> {
  const stepId = await ctx.deps.runStore.createStep({
    runId: ctx.run.runId,
    actionPath: formatActionPath(path),
    actionId: action.id ?? null,
    actionKind: "wait_for_trigger",
    providerActionId: null,
  });

  const timeoutAt = action.wait_for_trigger.timeout_seconds
    ? new Date(Date.now() + action.wait_for_trigger.timeout_seconds * 1000)
    : null;

  const contextKey =
    action.wait_for_trigger.context_key === undefined
      ? ctx.run.contextKey
      : renderString(
          action.wait_for_trigger.context_key,
          templateContext(ctx),
          ctx.deps.filters,
        );

  await ctx.deps.runStore.createWaitLock({
    runId: ctx.run.runId,
    actionPath: formatActionPath(path),
    kind: "trigger",
    eventId: action.wait_for_trigger.event,
    contextKey,
    filterTemplate: action.wait_for_trigger.filter ?? null,
    timeoutAt,
  });

  // Persist scope before suspending so the resume path has it.
  await checkpoint(ctx, path);

  await ctx.deps.runStore.updateStep(stepId, { status: "waiting" });
  return { kind: "suspended", stepId };
}

// ─── Primitive: `wait_until` ─────────────────────────────────────────────

/**
 * Suspend the run until a condition becomes true, with an optional
 * timeout. Unlike `wait_for_trigger` (wait for an event), this polls the
 * condition on an interval, re-resolving live state each tick.
 *
 * Fast path: if the condition is ALREADY true against the current
 * (enriched) scope, continue inline without suspending. Otherwise persist
 * a `kind: "until"` wait lock carrying the condition + poll interval +
 * timeout policy, enqueue the first re-check, and suspend. The wait-until
 * queue consumer (and the sweeper, as a backstop) drive the re-checks.
 */
async function executeWaitUntil(
  action: WaitUntilInput,
  path: ActionPath,
  ctx: DispatchContext,
): Promise<StepOutcome> {
  const stepId = await ctx.deps.runStore.createStep({
    runId: ctx.run.runId,
    actionPath: formatActionPath(path),
    actionId: action.id ?? null,
    actionKind: "wait_until",
    providerActionId: null,
  });

  const cfg = action.wait_until;

  // Fast path — already satisfied. Evaluate against the current scope
  // (enriched at run start / resume). Errors are treated as "not yet".
  let satisfied = false;
  try {
    satisfied = evaluateCondition(
      cfg.condition,
      templateContext(ctx),
      ctx.deps.filters,
    );
  } catch (error) {
    ctx.deps.logger.debug(
      `wait_until initial eval threw (treating as not-yet): ${(error as Error).message}`,
    );
  }
  if (satisfied) {
    await ctx.deps.runStore.updateStep(stepId, {
      status: "success",
      resultPayload: { satisfied: true, immediate: true },
    });
    return { kind: "ok" };
  }

  const pollSeconds = cfg.poll_seconds ?? 30;
  const continueOnTimeout = cfg.continue_on_timeout ?? true;
  const timeoutAt = cfg.timeout_seconds
    ? new Date(Date.now() + cfg.timeout_seconds * 1000)
    : null;

  const waitLockId = await ctx.deps.runStore.createWaitLock({
    runId: ctx.run.runId,
    actionPath: formatActionPath(path),
    kind: "until",
    // Synthetic marker — `until` locks aren't woken by events.
    eventId: `@@until:${ctx.run.runId}:${formatActionPath(path)}`,
    contextKey: ctx.run.contextKey,
    filterTemplate: null,
    timeoutAt,
    waitConfig: {
      condition: cfg.condition,
      pollSeconds,
      continueOnTimeout,
    },
  });

  // Persist scope before suspending so each re-check rebuilds it.
  await checkpoint(ctx, path);

  const queue = ctx.deps.queueManager.getQueue<WaitUntilCheckJob>(
    WAIT_UNTIL_QUEUE_NAME,
  );
  await queue.enqueue(
    { runId: ctx.run.runId, waitLockId },
    {
      startDelay: pollSeconds,
      jobId: `${ctx.run.runId}:${waitLockId}`,
    },
  );

  await ctx.deps.runStore.updateStep(stepId, {
    status: "waiting",
    resultPayload: { waitLockId, pollSeconds, timeoutAt: timeoutAt?.toISOString() },
  });
  return { kind: "suspended", stepId };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

// ─── Primitive: `sequence` ───────────────────────────────────────────────

/**
 * Wrap an ordered list of actions as a single Action. Walking semantics
 * are identical to walking a top-level `actions:` list — including
 * suspension propagation and resume support.
 *
 * Primary use case: providing multi-action branches inside `parallel`.
 * Resume routing through `sequence` consumes `["sequence", innerIdx, …]`
 * from the remainder.
 */
async function executeSequence(
  action: SequenceInput,
  path: ActionPath,
  ctx: DispatchContext,
  resumeRemainder?: ActionPath,
): Promise<StepOutcome> {
  const stepId = await ctx.deps.runStore.createStep({
    runId: ctx.run.runId,
    actionPath: formatActionPath(path),
    actionId: action.id ?? null,
    actionKind: "sequence",
    providerActionId: null,
  });

  let outcome: SequenceOutcome;
  if (resumeRemainder !== undefined && resumeRemainder.length > 0) {
    if (resumeRemainder[0] !== "sequence") {
      throw new Error(
        `Resume path corrupt at ${formatActionPath(path)}: expected "sequence", got ${String(
          resumeRemainder[0],
        )}`,
      );
    }
    const inner = resumeRemainder.slice(1);
    outcome = await walkSequence(
      action.sequence,
      [...path, "sequence"],
      ctx,
      { resumeRemainder: inner },
    );
  } else {
    outcome = await walkSequence(
      action.sequence,
      [...path, "sequence"],
      ctx,
    );
  }

  await ctx.deps.runStore.updateStep(stepId, {
    status:
      outcome.kind === "completed"
        ? "success"
        : outcome.kind === "suspended"
          ? "waiting"
          : "failed",
    errorMessage: outcome.kind === "stopped" ? outcome.reason : undefined,
  });
  if (outcome.kind === "completed") await checkpoint(ctx, path);
  return sequenceToStep(outcome);
}

function sequenceToStep(seq: SequenceOutcome): StepOutcome {
  if (seq.kind === "completed") return { kind: "ok" };
  if (seq.kind === "suspended") {
    return { kind: "suspended", stepId: seq.suspendingStepId };
  }
  if (seq.error) {
    return { kind: "failed", error: seq.reason ?? "stopped with error" };
  }
  return { kind: "stopped", reason: seq.reason };
}
