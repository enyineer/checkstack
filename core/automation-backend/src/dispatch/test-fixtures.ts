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
  LoadedRun,
  LoadedWaitLock,
  RunStore,
} from "./types";
import type { RunStateSnapshot, RunStateStore } from "./run-state-store";

export function createInMemoryRunStore(): {
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
    async countActiveRuns(automationId) {
      let count = 0;
      for (const r of runs.values()) {
        if (
          r.automationId === automationId &&
          ["pending", "running", "waiting"].includes(r.status)
        ) {
          count += 1;
        }
      }
      return count;
    },
    async hasActiveRun(automationId) {
      return (await this.countActiveRuns(automationId)) > 0;
    },
    async cancelActiveRuns(automationId, reason) {
      const cancelled: string[] = [];
      for (const r of runs.values()) {
        if (
          r.automationId === automationId &&
          ["pending", "running", "waiting"].includes(r.status)
        ) {
          r.status = "cancelled";
          r.errorMessage = reason;
          r.finishedAt = new Date();
          cancelled.push(r.id);
        }
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

export function createInMemoryRunStateStore(): {
  store: RunStateStore;
  states: Map<string, RunStateSnapshot>;
  locks: Set<string>;
} {
  const states = new Map<string, RunStateSnapshot>();
  const locks = new Set<string>();

  const store: RunStateStore = {
    async upsert(input) {
      states.set(input.runId, {
        scopeSnapshot: input.scopeSnapshot,
        lastActionPath: input.lastActionPath,
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
        if (s.lastHeartbeatAt < threshold) ids.push(runId);
      }
      return ids;
    },
    async tryAdvisoryLock(runId) {
      if (locks.has(runId)) return false;
      locks.add(runId);
      return true;
    },
    async releaseAdvisoryLock(runId) {
      locks.delete(runId);
    },
  };

  return { store, states, locks };
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
}): {
  deps: DispatchDeps;
  runs: ReturnType<typeof createInMemoryRunStore>;
  artifacts: ReturnType<typeof createInMemoryArtifactStore>;
  state: ReturnType<typeof createInMemoryRunStateStore>;
  queue: FakeQueueManager;
} {
  const runs = createInMemoryRunStore();
  const artifacts = createInMemoryArtifactStore();
  const state = createInMemoryRunStateStore();
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
    queueManager: queue.manager,
    healthCheckClient: opts?.healthCheckClient,
    getService: async () => {
      throw new Error("getService not stubbed for this test");
    },
  };
  return { deps, runs, artifacts, state, queue };
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
