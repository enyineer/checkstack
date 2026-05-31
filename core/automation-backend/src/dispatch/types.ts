/**
 * Internal types for the automation dispatch engine.
 *
 * These are kept private to `automation-backend` — public API lives in
 * `@checkstack/automation-common` and the package's index re-exports.
 */
import type { Logger, ServiceRef } from "@checkstack/backend-api";
import type {
  AutomationDefinition,
  Condition,
} from "@checkstack/automation-common";
import type { QueueManager } from "@checkstack/queue-api";
import type { FilterRegistry } from "@checkstack/template-engine";
import type { InferClient } from "@checkstack/common";
import type { HealthCheckApi } from "@checkstack/healthcheck-common";

import type { ActionRegistry } from "../action-registry";
import type { ArtifactTypeRegistry } from "../artifact-type-registry";
import type { TriggerRegistry } from "../trigger-registry";
import type { ArtifactStore } from "../artifact-store";

import type { RunStateStore } from "./run-state-store";
import type { RunSecretRegistry } from "./run-secret-registry";
import type { EntityKindResolver } from "./state-scope";

/**
 * Persistent dependency bundle threaded through the dispatch engine.
 * Provided once by the plugin entry; reused for every run / step.
 */
export interface DispatchDeps {
  logger: Logger;
  filters: FilterRegistry;
  registries: {
    triggers: TriggerRegistry;
    actions: ActionRegistry;
    artifactTypes: ArtifactTypeRegistry;
  };
  artifactStore: ArtifactStore;
  /** Resolve a platform service ref — passed through to action `execute`. */
  getService: <T>(ref: ServiceRef<T>) => Promise<T>;
  /** Persistence backend for runs / steps / wait locks. */
  runStore: RunStore;
  /** Per-run scope snapshot + heartbeat + advisory-lock helpers. */
  runStateStore: RunStateStore;
  /**
   * Queue manager for crash-safe time-based suspension (`delay` action)
   * and any future queue-backed continuations.
   */
  queueManager: QueueManager;
  /**
   * Health-check client for the sensing layer's scope pre-resolution
   * (`enrichScopeWithState`) and the `for:` dwell re-confirm. Optional so
   * test harnesses and minimal installs that don't sense live state can
   * omit it — enrichment then fails open to an empty `health` namespace,
   * and a dwell with no client re-confirms without a status gate.
   */
  healthCheckClient?: InferClient<typeof HealthCheckApi>;
  /**
   * Kind-agnostic entity resolver for reactive `wait_until` wake re-eval
   * (reactive automation engine §3.6, §8). On wake, the engine re-enriches
   * scope with EVERY `state.<kind>.<id>` ref the wait depends on, resolved
   * through the framework entity store. Returns a batched `getMany`-style
   * resolver for a registered kind, or `undefined` for an unknown kind (the
   * enrichment then leaves that kind unresolved, fail-open). Optional so test
   * harnesses / minimal installs without the entity store omit it — non-health
   * waits then can't re-resolve their state (health waits still work via
   * `healthCheckClient`).
   */
  entityResolverFor?: (kind: string) => EntityKindResolver | undefined;
  /** Persistence backend for pre-run `for:` dwell timers. */
  dwellStore: DwellStore;
  /** Persistence backend for windowed-count / rate trigger gates. */
  windowStore: WindowStore;
  /**
   * Run-scoped secret registry. When set, the engine wraps each run's
   * `getService` so resolving the secret resolver / connection store
   * registers the resolved values, and the run store masks step / run
   * output before persistence. Optional so tests / minimal installs skip
   * masking. `secretResolverRefId` / `connectionStoreRefId` carry the
   * service-ref ids to intercept (passed as strings to avoid a dependency
   * cycle from the dispatch core onto the secrets / integration packages).
   */
  secretRegistry?: RunSecretRegistry;
  secretResolverRefId?: string;
  connectionStoreRefId?: string;
  /**
   * Serialize a short critical section under a transaction-scoped advisory
   * lock keyed on `key` (blocks until granted, auto-releases at COMMIT).
   * Used to make the concurrency-mode check-then-create atomic per
   * `(automationId, scopeKey)` so two concurrent fires / a dwell-fire /
   * cross-pod can't both pass a `single`-mode "no active run" check and
   * both create a run. Optional so tests / minimal installs degrade to the
   * unserialized check (correct under a single in-process caller).
   */
  withConcurrencyLock?: <T>(key: string, fn: () => Promise<T>) => Promise<T>;
}

/**
 * A node-style action path. Strings index into "actions", "sequence",
 * etc.; numbers index array positions.
 *
 *   ["actions", 0]                                 // first top-level action
 *   ["actions", 1, "choose", 0, "sequence", 2]     // 3rd action in first choose branch of 2nd action
 *   ["actions", 3, "parallel", 1]                  // 2nd parallel branch of 4th action
 *   ["actions", 4, "repeat", "sequence", 0]        // 1st action in repeat sequence of 5th action
 */
export type ActionPath = ReadonlyArray<string | number>;

/**
 * Serialize an action path for persistence / display. We keep it
 * URL-ish for readability in the run-detail UI.
 *
 *   ["actions", 0]  →  "actions[0]"
 *   ["actions", 1, "choose", 0, "sequence", 2]  →  "actions[1].choose[0].sequence[2]"
 */
export function formatActionPath(path: ActionPath): string {
  let out = "";
  for (const segment of path) {
    if (typeof segment === "number") {
      out += `[${segment}]`;
    } else {
      out += out.length === 0 ? segment : `.${segment}`;
    }
  }
  return out;
}

/**
 * The terminal outcomes of executing a single action.
 */
export type StepOutcome =
  | { kind: "ok" }
  | { kind: "skipped"; reason: string }
  | { kind: "failed"; error: string }
  | { kind: "stopped"; reason?: string; error?: boolean }
  | { kind: "suspended"; stepId: string };

/**
 * The outcomes of walking a sequence (top-level `actions:`, a `choose`
 * branch, a `parallel` branch, a `repeat` iteration body, etc.).
 */
export type SequenceOutcome =
  | { kind: "completed" }
  | { kind: "stopped"; reason?: string; error?: boolean }
  | { kind: "suspended"; suspendingStepId: string };

/**
 * Loaded automation row + parsed definition. Convenience wrapper to keep
 * call sites tidy.
 */
export interface LoadedAutomation {
  id: string;
  name: string;
  status: "enabled" | "disabled";
  definition: AutomationDefinition;
}

/**
 * Top-level run identity carried through the walker.
 */
export interface RunIdentity {
  runId: string;
  automation: LoadedAutomation;
  /** Operator-assigned trigger id or auto-derived (`event` slug). */
  triggerId: string;
  /** Fully qualified event id that fired. */
  triggerEventId: string;
  contextKey: string | null;
  startedAt: Date;
}

/**
 * Execution context handed to each primitive handler.
 *
 * - `scope` is the template-engine variable bag for the current position
 *   in the tree. The walker rebuilds this when entering / exiting
 *   nested blocks (variables, repeat iterations, etc.).
 * - `payload` is the original trigger payload — convenient for actions
 *   that want to reach it directly.
 * - `consumedArtifacts` is a lazy view — the dispatcher resolves it
 *   when an action declares `consumes` rather than scanning every step.
 */
export interface DispatchContext {
  deps: DispatchDeps;
  run: RunIdentity;
  payload: Record<string, unknown>;
  /** Mutable variable scope. Modified by `variables` / `repeat`. */
  scope: Record<string, unknown>;
  /** When inside `wait_for_trigger`'s resume path, set to true. */
  resuming: boolean;
}

// ─── Run-store interface ─────────────────────────────────────────────────

/**
 * Persistence operations the dispatch engine needs. Implemented in
 * `run-state.ts` against the Drizzle schema.
 */
export interface RunStore {
  // Runs
  createRun(input: CreateRunInput): Promise<string>;
  updateRunStatus(
    runId: string,
    status: "running" | "waiting" | "success" | "failed" | "cancelled" | "skipped",
    errorMessage?: string,
  ): Promise<void>;
  loadRun(runId: string): Promise<LoadedRun | undefined>;
  /**
   * Active-run count. When `contextKey` is omitted, counts across the
   * whole automation (the default per-automation concurrency scope);
   * when provided (including `null`), counts only runs with that context
   * key (the per-context-key scope).
   */
  countActiveRuns(
    automationId: string,
    contextKey?: string | null,
  ): Promise<number>;
  /** Used by `mode: "single"` to detect a pre-existing run. See `countActiveRuns` for `contextKey`. */
  hasActiveRun(
    automationId: string,
    contextKey?: string | null,
  ): Promise<boolean>;
  /** Used by `mode: "restart"` to abort prior runs. See `countActiveRuns` for `contextKey`. */
  cancelActiveRuns(
    automationId: string,
    reason: string,
    contextKey?: string | null,
  ): Promise<string[]>;

  // Steps
  createStep(input: CreateStepInput): Promise<string>;
  updateStep(
    stepId: string,
    patch: {
      status: "running" | "success" | "failed" | "skipped" | "waiting";
      errorMessage?: string;
      resultPayload?: Record<string, unknown>;
      incrementAttempts?: boolean;
    },
  ): Promise<void>;
  /**
   * Find the most recent step row for a given `(runId, actionPath)`.
   * Used by container resumes (parallel / repeat) to look up the
   * step they wrote at suspension so they can read accumulated state
   * (branch outcomes, iteration list) from its `result_payload`.
   */
  findStepByPath(
    runId: string,
    actionPath: string,
  ): Promise<LoadedStep | undefined>;

  // Wait locks (for wait_for_trigger + delay + wait_until durability)
  createWaitLock(input: CreateWaitLockInput): Promise<string>;
  /**
   * Insert a `kind: "until"` wait lock PLUS its wake-index dependency rows
   * (one per ref) atomically (reactive automation engine §8.2). The
   * `(waitLockId, ref)` pair is unique, so duplicate refs collapse via
   * `ON CONFLICT DO NOTHING`. Returns the new wait-lock id.
   */
  createWaitLockWithWakeRefs(input: CreateWaitLockWithRefsInput): Promise<string>;
  loadWaitLock(id: string): Promise<LoadedWaitLock | undefined>;
  findWaitLocksFor(
    eventId: string,
    contextKey: string | null,
  ): Promise<LoadedWaitLock[]>;
  /**
   * Wake-index intersection lookup (reactive automation engine §8.2): every
   * `kind: "until"` wait lock that depends on `ref` (exact match) OR on the
   * kind-level wildcard for `ref`'s kind. Generalizes `findWaitLocksFor`.
   */
  findWaitLocksByWakeRef(ref: string): Promise<LoadedWaitLock[]>;
  /** All wait locks of a given kind — powers the sweeper's `until` re-tick. */
  findWaitLocksByKind(kind: WaitLockKind): Promise<LoadedWaitLock[]>;
  /**
   * All wait locks belonging to a run. Used by stalled-recovery to detect
   * a live wait (refuse to from-top recover a genuinely-suspended run) and
   * to delete leftover locks before a from-top re-walk (so recovery
   * doesn't leak a second lock + duplicate delay job).
   */
  findWaitLocksByRun(runId: string): Promise<LoadedWaitLock[]>;
  deleteWaitLock(id: string): Promise<void>;
  sweepExpiredWaitLocks(now: Date): Promise<LoadedWaitLock[]>;
}

export interface CreateRunInput {
  automationId: string;
  triggerId: string;
  triggerEventId: string;
  triggerPayload: Record<string, unknown>;
  contextKey: string | null;
}

export interface LoadedRun {
  id: string;
  automationId: string;
  triggerId: string;
  triggerEventId: string;
  triggerPayload: Record<string, unknown>;
  contextKey: string | null;
  status: string;
  errorMessage: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

export interface CreateStepInput {
  runId: string;
  actionPath: string;
  actionId: string | null;
  actionKind: string;
  providerActionId: string | null;
}

export interface LoadedStep {
  id: string;
  runId: string;
  actionPath: string;
  actionId: string | null;
  actionKind: string;
  status: string;
  attempts: number;
  errorMessage: string | null;
  resultPayload: Record<string, unknown> | null;
  startedAt: Date;
  finishedAt: Date | null;
}

export type WaitLockKind = "trigger" | "delay" | "until";

/**
 * Persisted config for a `kind: "until"` wait lock. The condition can be a
 * structured object, so it rides in the lock's `waitConfig` jsonb rather
 * than `filterTemplate`.
 */
export interface UntilWaitConfig {
  condition: Condition;
  continueOnTimeout: boolean;
}

export interface CreateWaitLockInput {
  runId: string;
  actionPath: string;
  kind: WaitLockKind;
  eventId: string;
  contextKey: string | null;
  filterTemplate: string | null;
  timeoutAt: Date | null;
  /** Only set for `kind: "until"`. */
  waitConfig?: UntilWaitConfig | null;
}

/**
 * A reactive `wait_until` suspend: the wait lock plus the wake-index refs
 * its condition depends on (reactive automation engine §8.2). `kind` is
 * always `"until"`; the refs are the `${kind}:${id}` (or `${kind}:*`)
 * strings the condition reads.
 */
export interface CreateWaitLockWithRefsInput {
  runId: string;
  actionPath: string;
  eventId: string;
  contextKey: string | null;
  timeoutAt: Date | null;
  waitConfig: UntilWaitConfig;
  /** Wake-index dependency refs (`${kind}:${id}` or `${kind}:*`). */
  wakeRefs: ReadonlyArray<string>;
}

export interface LoadedWaitLock {
  id: string;
  runId: string;
  actionPath: string;
  kind: WaitLockKind;
  eventId: string;
  contextKey: string | null;
  filterTemplate: string | null;
  timeoutAt: Date | null;
  waitConfig: UntilWaitConfig | null;
  createdAt: Date;
}

// ─── Dwell-timer store interface ─────────────────────────────────────────

/** Candidate dwell to arm. `fireAt` is used only on a fresh INSERT. */
export interface UpsertDwellInput {
  automationId: string;
  triggerId: string;
  eventId: string;
  contextKey: string | null;
  armedStatus: string | null;
  payloadSnapshot: Record<string, unknown>;
  actorSnapshot: Record<string, unknown>;
  fireAt: Date;
}

export interface LoadedDwell {
  id: string;
  automationId: string;
  triggerId: string;
  eventId: string;
  contextKey: string | null;
  armedStatus: string | null;
  payloadSnapshot: Record<string, unknown>;
  actorSnapshot: Record<string, unknown>;
  fireAt: Date;
  createdAt: Date;
}

/** Result of an idempotent {@link DwellStore.arm}. */
export interface ArmDwellResult {
  id: string;
  /**
   * True when a NEW dwell row was inserted; false when a dwell already
   * existed for the key and was preserved unchanged.
   */
  created: boolean;
  /**
   * The row's `fireAt` — for a continuation this is the ORIGINAL arm
   * deadline, NOT the incoming candidate, so a `for:` window measures
   * "continuously matched since first arm" (HA semantics).
   */
  fireAt: Date;
}

/**
 * Persistence for pre-run `for:` dwell timers. The dwell row is the
 * source of truth; the `automation-dwell` queue job is just the wake
 * signal, and cancellation is a row delete (constraint 2).
 */
export interface DwellStore {
  /**
   * Arm a dwell idempotently on the unique
   * `(automationId, triggerId, contextKey)` key.
   *
   *   - No row exists → INSERT with the supplied `fireAt` + snapshot.
   *   - A row already exists → preserve it UNCHANGED (same `fireAt`).
   *
   * This is the correct `for:` semantic: a re-fire while the dwell is
   * still armed must NOT push the deadline forward, or a continuously
   * re-firing trigger (e.g. a level-triggered numeric_state) would never
   * elapse. A genuine recover-then-recur deletes the row first (via
   * inverse-cancel / re-confirm), so a fresh window starts then.
   */
  arm(input: UpsertDwellInput): Promise<ArmDwellResult>;
  load(id: string): Promise<LoadedDwell | undefined>;
  /** Look up the single dwell for a key, if armed. */
  findByKey(
    automationId: string,
    triggerId: string,
    contextKey: string | null,
  ): Promise<LoadedDwell | undefined>;
  /**
   * Delete one dwell (cancellation / fire). Idempotent. Returns `true`
   * only if THIS call deleted the row, so a caller can use the delete as
   * an atomic claim: whoever gets `true` owns the fire, racing callers
   * (a second pod, or the sweeper vs the queue consumer) get `false`.
   */
  delete(id: string): Promise<boolean>;
  /** Delete by key (early cancel on the inverse signal). Idempotent. */
  deleteByKey(
    automationId: string,
    triggerId: string,
    contextKey: string | null,
  ): Promise<void>;
  /** Drop every dwell for an automation (disabled / deleted). */
  deleteForAutomation(automationId: string): Promise<void>;
  /** Dwells whose `fireAt` has passed — the sweeper fallback. */
  sweepExpired(now: Date): Promise<LoadedDwell[]>;
}

// ─── Windowed-count store interface ──────────────────────────────────────

/** Re-fire policy for a windowed-count gate. */
export type WindowRefire = "every" | "once";

/** Inputs to {@link WindowStore.recordAndCount}. */
export interface RecordWindowInput {
  automationId: string;
  triggerId: string;
  eventId: string;
  contextKey: string | null;
  /** When the qualifying occurrence happened (the recorded row's timestamp). */
  occurredAt: Date;
  /** Trailing sliding window, in minutes. */
  windowMinutes: number;
  /** Occurrences within the window that arm the trigger. */
  threshold: number;
  /** `every` fires at/over the threshold; `once` fires only on the crossing edge. */
  refire: WindowRefire;
}

/**
 * Persistence for windowed-count / rate trigger gates. The append log is the
 * source of truth; the in-window COUNT is a pure DB read, so every pod agrees.
 */
export interface WindowStore {
  /**
   * Append one qualifying occurrence and decide whether the trigger fires:
   *
   *  - records the row at `occurredAt`,
   *  - counts rows for `(automationId, triggerId, contextKey)` whose
   *    `occurredAt >= occurredAt - windowMinutes` (the new row is included),
   *  - returns `true` iff the re-fire policy fires for this occurrence:
   *      `every` → `newCount >= threshold`,
   *      `once`  → `newCount === threshold` (the crossing edge).
   *
   * Single INSERT per claimed emission ⇒ no double-count across pods.
   */
  recordAndCount(input: RecordWindowInput): Promise<boolean>;
  /** Delete occurrences older than `cutoff` — the sweeper's TTL prune. */
  sweepExpired(cutoff: Date): Promise<void>;
  /** Drop every occurrence for an automation (disabled / deleted). */
  deleteForAutomation(automationId: string): Promise<void>;
}
