/**
 * In-memory test fixtures for the dispatch engine.
 *
 * Provides minimal implementations of `RunStore`, `ArtifactStore`, and
 * registries so engine tests can run without a real database or queue.
 */
import { z } from "zod";
import { Versioned, createHook } from "@checkstack/backend-api";
import { createDefaultFilterRegistry } from "@checkstack/template-engine";
import type {
  ActionDefinition,
  TriggerDefinition,
} from "../action-types";
import { createActionRegistry, type ActionRegistry } from "../action-registry";
import {
  createArtifactTypeRegistry,
  type ArtifactTypeRegistry,
} from "../artifact-type-registry";
import { createTriggerRegistry, type TriggerRegistry } from "../trigger-registry";
import type { ArtifactStore, PersistedArtifact } from "../artifact-store";

import type {
  CreateRunInput,
  CreateStepInput,
  CreateWaitLockInput,
  DispatchDeps,
  DwellStore,
  LoadedDwell,
  LoadedRun,
  LoadedWaitLock,
  RunStore,
  UpsertDwellInput,
} from "./types";
import type { RunStateSnapshot, RunStateStore } from "./run-state-store";

export function createInMemoryRunStore(opts?: {
  /**
   * Called with the ids of runs cancelled by `cancelActiveRuns`, so a
   * caller (makeDispatchDeps) can clear the corresponding run-state rows -
   * faithfully modelling the real store, which deletes wait locks AND
   * run-state in the same operation.
   */
  onCancel?: (cancelledRunIds: string[]) => void;
}): {
  store: RunStore;
  runs: Map<string, LoadedRun>;
  steps: Array<{
    id: string;
    runId: string;
    actionPath: string;
    actionId: string | null;
    actionKind: string;
    providerActionId: string | null;
    status: string;
    attempts: number;
    errorMessage?: string;
    resultPayload?: Record<string, unknown>;
  }>;
  waitLocks: Map<string, LoadedWaitLock>;
} {
  const runs = new Map<string, LoadedRun>();
  const steps: Array<{
    id: string;
    runId: string;
    actionPath: string;
    actionId: string | null;
    actionKind: string;
    providerActionId: string | null;
    status: string;
    attempts: number;
    errorMessage?: string;
    resultPayload?: Record<string, unknown>;
  }> = [];
  const waitLocks = new Map<string, LoadedWaitLock>();
  const onCancel = opts?.onCancel;
  let runCounter = 0;
  let stepCounter = 0;
  let lockCounter = 0;

  const store: RunStore = {
    async createRun(input: CreateRunInput): Promise<string> {
      const id = `run-${++runCounter}`;
      runs.set(id, {
        id,
        automationId: input.automationId,
        triggerId: input.triggerId,
        triggerEventId: input.triggerEventId,
        triggerPayload: input.triggerPayload,
        contextKey: input.contextKey,
        status: "running",
        errorMessage: null,
        startedAt: new Date(),
        finishedAt: null,
      });
      return id;
    },
    async updateRunStatus(runId, status, errorMessage) {
      const r = runs.get(runId);
      if (!r) return;
      r.status = status;
      r.errorMessage = errorMessage ?? null;
      r.finishedAt = ["success", "failed", "cancelled", "skipped"].includes(
        status,
      )
        ? new Date()
        : null;
    },
    async loadRun(runId) {
      return runs.get(runId);
    },
    async countActiveRuns(automationId, contextKey?) {
      let count = 0;
      for (const r of runs.values()) {
        if (
          r.automationId === automationId &&
          ["pending", "running", "waiting"].includes(r.status) &&
          (contextKey === undefined || r.contextKey === contextKey)
        ) {
          count += 1;
        }
      }
      return count;
    },
    async hasActiveRun(automationId, contextKey?) {
      return (await this.countActiveRuns(automationId, contextKey)) > 0;
    },
    async cancelActiveRuns(automationId, reason, contextKey?) {
      const cancelled: string[] = [];
      for (const r of runs.values()) {
        if (
          r.automationId === automationId &&
          ["pending", "running", "waiting"].includes(r.status) &&
          (contextKey === undefined || r.contextKey === contextKey)
        ) {
          r.status = "cancelled";
          r.errorMessage = reason;
          r.finishedAt = new Date();
          cancelled.push(r.id);
        }
      }
      // Faithful model of the real store: tear down the cancelled runs'
      // wait locks in the same operation so a later wake can't resurrect
      // them. (Run-state clearing happens via the optional hook wired in
      // makeDispatchDeps.)
      if (cancelled.length > 0) {
        for (const [id, lock] of waitLocks) {
          if (cancelled.includes(lock.runId)) waitLocks.delete(id);
        }
        onCancel?.(cancelled);
      }
      return cancelled;
    },

    async createStep(input: CreateStepInput) {
      const id = `step-${++stepCounter}`;
      steps.push({
        id,
        runId: input.runId,
        actionPath: input.actionPath,
        actionId: input.actionId,
        actionKind: input.actionKind,
        providerActionId: input.providerActionId,
        status: "running",
        attempts: 1,
      });
      return id;
    },
    async updateStep(stepId, patch) {
      const step = steps.find((s) => s.id === stepId);
      if (!step) return;
      step.status = patch.status;
      step.errorMessage = patch.errorMessage;
      step.resultPayload = patch.resultPayload;
      if (patch.incrementAttempts) step.attempts += 1;
    },
    async findStepByPath(runId, actionPath) {
      const matches = steps.filter(
        (s) => s.runId === runId && s.actionPath === actionPath,
      );
      const last = matches.at(-1);
      if (!last) return;
      return {
        id: last.id,
        runId: last.runId,
        actionPath: last.actionPath,
        actionId: last.actionId,
        actionKind: last.actionKind,
        status: last.status,
        attempts: last.attempts,
        errorMessage: last.errorMessage ?? null,
        resultPayload: last.resultPayload ?? null,
        startedAt: new Date(),
        finishedAt: null,
      };
    },

    async createWaitLock(input: CreateWaitLockInput) {
      const id = `lock-${++lockCounter}`;
      waitLocks.set(id, {
        id,
        runId: input.runId,
        actionPath: input.actionPath,
        kind: input.kind,
        eventId: input.eventId,
        contextKey: input.contextKey,
        filterTemplate: input.filterTemplate,
        timeoutAt: input.timeoutAt,
        waitConfig: input.waitConfig ?? null,
        createdAt: new Date(),
      });
      return id;
    },
    async loadWaitLock(id) {
      return waitLocks.get(id);
    },
    async findWaitLocksFor(eventId, contextKey) {
      const matches: LoadedWaitLock[] = [];
      for (const lock of waitLocks.values()) {
        if (lock.eventId === eventId && lock.contextKey === contextKey) {
          matches.push(lock);
        }
      }
      return matches;
    },
    async findWaitLocksByKind(kind) {
      return [...waitLocks.values()].filter((lock) => lock.kind === kind);
    },
    async findWaitLocksByRun(runId) {
      return [...waitLocks.values()].filter((lock) => lock.runId === runId);
    },
    async deleteWaitLock(id) {
      waitLocks.delete(id);
    },
    async sweepExpiredWaitLocks(now) {
      const expired: LoadedWaitLock[] = [];
      for (const lock of waitLocks.values()) {
        if (lock.timeoutAt && lock.timeoutAt.getTime() <= now.getTime()) {
          expired.push(lock);
        }
      }
      return expired;
    },
  };

  return { store, runs, steps, waitLocks };
}

export function createInMemoryArtifactStore(): {
  store: ArtifactStore;
  artifacts: PersistedArtifact[];
} {
  const artifacts: PersistedArtifact[] = [];
  let counter = 0;

  const store: ArtifactStore = {
    async record(input) {
      const artifact: PersistedArtifact = {
        id: `artifact-${++counter}`,
        automationId: input.automationId,
        runId: input.runId,
        stepId: input.stepId,
        actionId: input.actionId,
        artifactType: input.artifactType,
        data: input.data,
        contextKey: input.contextKey,
        closedAt: null,
        createdAt: new Date(),
      };
      artifacts.push(artifact);
      return artifact;
    },
    async find(input) {
      const all = await this.findAll(input);
      return all[0];
    },
    async findAll(input) {
      return artifacts
        .filter((a) => a.automationId === input.automationId)
        .filter(
          (a) =>
            input.contextKey === undefined ||
            input.contextKey === null ||
            a.contextKey === input.contextKey,
        )
        .filter(
          (a) => !input.artifactType || a.artifactType === input.artifactType,
        )
        .filter((a) => !input.actionId || a.actionId === input.actionId)
        .filter((a) => !(input.onlyOpen ?? true) || a.closedAt === null)
        .toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
    async markClosed(artifactId) {
      const a = artifacts.find((x) => x.id === artifactId);
      if (a) a.closedAt = new Date();
    },
  };

  return { store, artifacts };
}

/**
 * @param runs - the run store's `runs` map, so `findStalledRunIds`
 *   faithfully models the real DB join that filters to `status =
 *   'running'`. Without it the fake would skip the status filter and a
 *   test couldn't observe the C1 fix (a `waiting` run must NOT be swept).
 */
export function createInMemoryRunStateStore(
  runs?: Map<string, LoadedRun>,
): {
  store: RunStateStore;
  states: Map<string, RunStateSnapshot>;
  locks: Set<string>;
} {
  const states = new Map<string, RunStateSnapshot>();
  const locks = new Set<string>();

  const store: RunStateStore = {
    async upsert(input) {
      const existing = states.get(input.runId);
      // Mirror the real store: omitting `lastActionPath` on an existing
      // row preserves the prior checkpoint; passing it (incl. null) sets it.
      const lastActionPath =
        input.lastActionPath === undefined
          ? (existing?.lastActionPath ?? null)
          : input.lastActionPath;
      states.set(input.runId, {
        scopeSnapshot: input.scopeSnapshot,
        lastActionPath,
        lastHeartbeatAt: new Date(),
      });
    },
    async load(runId) {
      return states.get(runId);
    },
    async clear(runId) {
      states.delete(runId);
    },
    async heartbeat(runId) {
      const s = states.get(runId);
      if (s) s.lastHeartbeatAt = new Date();
    },
    async findStalledRunIds(threshold) {
      const ids: string[] = [];
      for (const [runId, s] of states.entries()) {
        if (s.lastHeartbeatAt >= threshold) continue;
        // Faithful model of the DB join: only `running` runs are stalled.
        if (runs && runs.get(runId)?.status !== "running") continue;
        ids.push(runId);
      }
      return ids;
    },
    async tryAdvisoryLock(runId) {
      if (locks.has(runId)) return null;
      locks.add(runId);
      let released = false;
      return {
        async release() {
          if (released) return;
          released = true;
          locks.delete(runId);
        },
      };
    },
  };

  return { store, states, locks };
}

export function createInMemoryDwellStore(): {
  store: DwellStore;
  dwells: Map<string, LoadedDwell>;
} {
  const dwells = new Map<string, LoadedDwell>();
  let counter = 0;

  const matchesKey = (
    d: LoadedDwell,
    automationId: string,
    triggerId: string,
    contextKey: string | null,
  ) =>
    d.automationId === automationId &&
    d.triggerId === triggerId &&
    d.contextKey === contextKey;

  const store: DwellStore = {
    async arm(input: UpsertDwellInput) {
      // Insert-if-absent: preserve an existing dwell's original fireAt.
      const existing = [...dwells.values()].find((d) =>
        matchesKey(d, input.automationId, input.triggerId, input.contextKey),
      );
      if (existing) {
        return { id: existing.id, created: false, fireAt: existing.fireAt };
      }
      const id = `dwell-${++counter}`;
      dwells.set(id, {
        id,
        automationId: input.automationId,
        triggerId: input.triggerId,
        eventId: input.eventId,
        contextKey: input.contextKey,
        armedStatus: input.armedStatus,
        payloadSnapshot: input.payloadSnapshot,
        actorSnapshot: input.actorSnapshot,
        fireAt: input.fireAt,
        createdAt: new Date(),
      });
      return { id, created: true, fireAt: input.fireAt };
    },
    async load(id) {
      return dwells.get(id);
    },
    async findByKey(automationId, triggerId, contextKey) {
      return [...dwells.values()].find((d) =>
        matchesKey(d, automationId, triggerId, contextKey),
      );
    },
    async delete(id) {
      // Map.delete returns true only if the key existed — a faithful
      // model of the DB's `DELETE ... RETURNING` atomic claim.
      return dwells.delete(id);
    },
    async deleteByKey(automationId, triggerId, contextKey) {
      for (const [id, d] of dwells.entries()) {
        if (matchesKey(d, automationId, triggerId, contextKey)) dwells.delete(id);
      }
    },
    async deleteForAutomation(automationId) {
      for (const [id, d] of dwells.entries()) {
        if (d.automationId === automationId) dwells.delete(id);
      }
    },
    async sweepExpired(now) {
      return [...dwells.values()].filter(
        (d) => d.fireAt.getTime() <= now.getTime(),
      );
    },
  };

  return { store, dwells };
}

/**
 * Minimal in-memory queue manager stub for engine tests. Records enqueued
 * jobs so a test can fire them synchronously to simulate the delay
 * scheduler.
 */
export interface FakeQueueManager {
  manager: DispatchDeps["queueManager"];
  jobs: Array<{
    queue: string;
    data: unknown;
    startDelay?: number;
    jobId?: string;
  }>;
  fireAll: () => Promise<void>;
}

export function createFakeQueueManager(opts?: {
  onJob?: (queue: string, data: unknown) => Promise<void> | void;
}): FakeQueueManager {
  const jobs: FakeQueueManager["jobs"] = [];
  const consumers = new Map<
    string,
    (job: { id: string; data: unknown; timestamp: Date; attempts?: number }) => Promise<void>
  >();

  const queueFor = <T>(name: string) => ({
    async enqueue(
      data: T,
      options?: { startDelay?: number; jobId?: string; priority?: number },
    ) {
      jobs.push({
        queue: name,
        data,
        startDelay: options?.startDelay,
        jobId: options?.jobId,
      });
      await opts?.onJob?.(name, data);
      return options?.jobId ?? `job-${jobs.length}`;
    },
    async consume(
      consumer: (job: {
        id: string;
        data: unknown;
        timestamp: Date;
        attempts?: number;
      }) => Promise<void>,
    ) {
      consumers.set(name, consumer);
    },
    async scheduleRecurring() {
      return "test-recurring";
    },
    async cancelRecurring() {},
    async listRecurringJobs() {
      return [];
    },
    async getRecurringJobDetails() {
      return;
    },
    async getInFlightCount() {
      return 0;
    },
    async testConnection() {},
    async stop() {},
    async getStats() {
      return {
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        consumerGroups: 0,
        scope: "instance" as const,
      };
    },
    async listJobs() {
      return { items: [], total: 0, cursor: null };
    },
  });

  const manager = {
    getQueue: queueFor,
    getActivePlugin: () => "memory",
    getActiveConfig: () => ({}),
    setActiveBackend: async () => ({
      previousPlugin: "memory",
      newPlugin: "memory",
      migratedJobs: 0,
    }),
    getInFlightJobCount: async () => 0,
    getAggregatedStats: async () => ({
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      consumerGroups: 0,
      scope: "instance" as const,
    }),
    listJobs: async () => ({ items: [], total: 0, cursor: null }),
    listAllRecurringJobs: async () => [],
    startPolling: () => {},
    shutdown: async () => {},
  } as unknown as DispatchDeps["queueManager"];

  return {
    manager,
    jobs,
    async fireAll() {
      for (const job of jobs.splice(0)) {
        const consumer = consumers.get(job.queue);
        if (!consumer) continue;
        await consumer({
          id: job.jobId ?? "job",
          data: job.data,
          timestamp: new Date(),
        });
      }
    },
  };
}

/**
 * Compose a complete `DispatchDeps` for tests. Callers can pre-populate
 * the action / artifact-type / trigger registries before invoking the
 * engine.
 */
export function makeDispatchDeps(opts?: {
  actions?: ActionRegistry;
  artifactTypes?: ArtifactTypeRegistry;
  triggers?: TriggerRegistry;
  /** Optional health-check client for sensing-layer enrichment tests. */
  healthCheckClient?: DispatchDeps["healthCheckClient"];
  /**
   * Wire a faithful in-memory serializing lock for the concurrency-mode
   * check-then-create (models the real transaction-scoped advisory lock:
   * keyed, blocks until granted). Off by default so the natural
   * check-then-create race is observable in tests that don't opt in.
   */
  withConcurrencyLock?: boolean;
}): {
  deps: DispatchDeps;
  runs: ReturnType<typeof createInMemoryRunStore>;
  artifacts: ReturnType<typeof createInMemoryArtifactStore>;
  state: ReturnType<typeof createInMemoryRunStateStore>;
  dwells: ReturnType<typeof createInMemoryDwellStore>;
  queue: FakeQueueManager;
} {
  // `cancelActiveRuns` clears the cancelled runs' run-state rows too (the
  // real store deletes wait locks + run-state in one op). The run-state map
  // doesn't exist yet, so let the cancel hook reach it lazily via a holder.
  const stateHolder: {
    store?: ReturnType<typeof createInMemoryRunStateStore>;
  } = {};
  const runs = createInMemoryRunStore({
    onCancel: (ids) => {
      for (const id of ids) stateHolder.store?.states.delete(id);
    },
  });
  const artifacts = createInMemoryArtifactStore();
  const state = createInMemoryRunStateStore(runs.runs);
  stateHolder.store = state;
  const dwells = createInMemoryDwellStore();
  const queue = createFakeQueueManager();
  const noopLogger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  } as unknown as DispatchDeps["logger"];
  const deps: DispatchDeps = {
    logger: noopLogger,
    filters: createDefaultFilterRegistry(),
    registries: {
      triggers: opts?.triggers ?? createTriggerRegistry(),
      actions: opts?.actions ?? createActionRegistry(),
      artifactTypes: opts?.artifactTypes ?? createArtifactTypeRegistry(),
    },
    runStore: runs.store,
    artifactStore: artifacts.store,
    runStateStore: state.store,
    dwellStore: dwells.store,
    queueManager: queue.manager,
    healthCheckClient: opts?.healthCheckClient,
    getService: async () => {
      throw new Error("getService not stubbed for this test");
    },
  };
  if (opts?.withConcurrencyLock) {
    // A faithful keyed async mutex: a second caller for the same key awaits
    // the first's completion, exactly like pg_advisory_xact_lock blocking
    // until COMMIT. Distinct keys never contend.
    const chains = new Map<string, Promise<unknown>>();
    deps.withConcurrencyLock = <T>(key: string, fn: () => Promise<T>) => {
      const prior = chains.get(key) ?? Promise.resolve();
      const next = prior.then(() => fn());
      // Keep the chain alive even if fn rejects, so the lock still releases
      // (catch swallows both outcomes into a settled void promise).
      chains.set(
        key,
        next.then(
          () => {},
          () => {},
        ),
      );
      return next;
    };
  }
  return { deps, runs, artifacts, state, dwells, queue };
}

// ─── Shared fixtures ────────────────────────────────────────────────────

export const testPlugin = { pluginId: "test" } as const;

/**
 * A no-op action that just records its config and returns success.
 *
 * By default this is a NON-producing action (no `produces`), so it can be
 * used freely as a "did it run" probe without an action `id`. Pass
 * `{ produces: true }` to make it emit a `recorded` artifact — producers
 * MUST be given an `id` in the automation so the artifact is referenceable
 * as `artifacts.<id>.recorded.*`.
 */
export function makeRecordingAction(opts?: { produces?: boolean }): {
  definition: ActionDefinition<{ value: string }, { recorded: string }>;
  calls: Array<{ value: string; consumedArtifacts: Record<string, unknown> }>;
} {
  const calls: Array<{
    value: string;
    consumedArtifacts: Record<string, unknown>;
  }> = [];
  const produces = opts?.produces ?? false;
  return {
    definition: {
      id: "record",
      displayName: "Record",
      config: new Versioned({
        version: 1,
        schema: z.object({ value: z.string() }),
      }),
      // Local artifact id — the registry qualifies it to `test.recorded`
      // (pluginId `test`).
      ...(produces ? { produces: "recorded" } : {}),
      execute: async (ctx) => {
        calls.push({
          value: ctx.config.value,
          consumedArtifacts: ctx.consumedArtifacts,
        });
        return {
          success: true,
          artifact: { recorded: ctx.config.value },
        };
      },
    },
    calls,
  };
}

/**
 * A failing action — always returns success: false.
 */
export function makeFailingAction(): ActionDefinition<{ reason: string }> {
  return {
    id: "fail",
    displayName: "Fail",
    config: new Versioned({
      version: 1,
      schema: z.object({ reason: z.string() }),
    }),
    execute: async (ctx) => ({
      success: false,
      error: ctx.config.reason,
    }),
  };
}

/** Hook used by tests that need a registered hook reference. */
export const testHook = createHook<{ id: string }>("test.event");

export function makeTrigger(): TriggerDefinition<{ id: string }> {
  return {
    id: "event",
    displayName: "Test event",
    payloadSchema: z.object({ id: z.string() }),
    hook: testHook,
    contextKey: (p) => p.id,
  };
}
