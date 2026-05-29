/**
 * Internal types for the automation dispatch engine.
 *
 * These are kept private to `automation-backend` — public API lives in
 * `@checkstack/automation-common` and the package's index re-exports.
 */
import type { Logger, ServiceRef } from "@checkstack/backend-api";
import type { AutomationDefinition } from "@checkstack/automation-common";
import type { QueueManager } from "@checkstack/queue-api";
import type { FilterRegistry } from "@checkstack/template-engine";

import type { ActionRegistry } from "../action-registry";
import type { ArtifactTypeRegistry } from "../artifact-type-registry";
import type { TriggerRegistry } from "../trigger-registry";
import type { ArtifactStore } from "../artifact-store";

import type { RunStateStore } from "./run-state-store";

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
  countActiveRuns(automationId: string): Promise<number>;
  /** Used by `mode: "single"` to detect a pre-existing run. */
  hasActiveRun(automationId: string): Promise<boolean>;
  /** Used by `mode: "restart"` to abort prior runs. */
  cancelActiveRuns(automationId: string, reason: string): Promise<string[]>;

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

  // Wait locks (for wait_for_trigger + delay durability)
  createWaitLock(input: CreateWaitLockInput): Promise<string>;
  loadWaitLock(id: string): Promise<LoadedWaitLock | undefined>;
  findWaitLocksFor(
    eventId: string,
    contextKey: string | null,
  ): Promise<LoadedWaitLock[]>;
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

export type WaitLockKind = "trigger" | "delay";

export interface CreateWaitLockInput {
  runId: string;
  actionPath: string;
  kind: WaitLockKind;
  eventId: string;
  contextKey: string | null;
  filterTemplate: string | null;
  timeoutAt: Date | null;
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
  createdAt: Date;
}
