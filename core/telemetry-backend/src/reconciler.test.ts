import { describe, it, expect } from "bun:test";
import { z } from "zod";
import { createMockLogger, createMockQueueManager } from "@checkstack/test-utils-backend";
import {
  PULL_JOB_PREFIX,
  clampInterval,
  computeDesiredPulls,
  createPullReconciler,
  pullJobId,
  sourceIdFromPullJobId,
  type ReconcileSourceRow,
  TELEMETRY_PULL_QUEUE,
} from "./reconciler";
import type { PullRunner } from "./runner";
import {
  createTelemetrySourceRegistry,
  defineTelemetrySourceType,
  type TelemetrySourceRegistry,
} from "./extension-points";

const pullType = defineTelemetrySourceType({
  id: "poller",
  displayName: "Poller",
  description: "",
  signals: ["logs"],
  configSchema: z.object({}),
  pull: {
    defaultIntervalSeconds: 60,
    minIntervalSeconds: 30,
    execute: async () => {},
  },
});

const webhookType = defineTelemetrySourceType({
  id: "hook",
  displayName: "Hook",
  description: "",
  signals: ["logs"],
  configSchema: z.object({}),
  webhook: { handle: async () => new Response(null) },
});

function registryWith(): TelemetrySourceRegistry {
  const registry = createTelemetrySourceRegistry();
  registry.register(pullType, { pluginId: "p" });
  registry.register(webhookType, { pluginId: "p" });
  return registry;
}

const PULL_QUALIFIED = "p.poller";
const WEBHOOK_QUALIFIED = "p.hook";

describe("pullJobId / sourceIdFromPullJobId", () => {
  it("round-trips", () => {
    expect(pullJobId("src-1")).toBe(`${PULL_JOB_PREFIX}src-1`);
    expect(sourceIdFromPullJobId(pullJobId("src-1"))).toBe("src-1");
    expect(sourceIdFromPullJobId("other:x")).toBeNull();
  });
});

describe("clampInterval", () => {
  it("defaults when unset and clamps below the minimum", () => {
    expect(clampInterval({ requested: null, defaultSeconds: 60, minSeconds: 30 })).toBe(60);
    expect(clampInterval({ requested: 10, defaultSeconds: 60, minSeconds: 30 })).toBe(30);
    expect(clampInterval({ requested: 120, defaultSeconds: 60, minSeconds: 30 })).toBe(120);
  });
});

describe("computeDesiredPulls", () => {
  const rows: ReconcileSourceRow[] = [
    { id: "a", sourceTypeId: PULL_QUALIFIED, enabled: true, intervalSeconds: 10, satelliteId: null },
    { id: "b", sourceTypeId: PULL_QUALIFIED, enabled: false, intervalSeconds: null, satelliteId: null },
    { id: "c", sourceTypeId: PULL_QUALIFIED, enabled: true, intervalSeconds: null, satelliteId: "sat-1" },
    { id: "d", sourceTypeId: WEBHOOK_QUALIFIED, enabled: true, intervalSeconds: null, satelliteId: null },
    { id: "e", sourceTypeId: "p.unknown", enabled: true, intervalSeconds: null, satelliteId: null },
  ];

  it("keeps only enabled, non-satellite, pull-capable, registered types (clamped)", () => {
    const desired = computeDesiredPulls({ rows, sourceRegistry: registryWith() });
    expect(desired).toEqual([
      { sourceId: "a", jobId: pullJobId("a"), intervalSeconds: 30 },
    ]);
  });
});

describe("createPullReconciler (applies plan to the queue)", () => {
  const runner: PullRunner = { run: async () => {} };

  it("reconcileAll schedules enabled instances and cancels orphans", async () => {
    const queueManager = createMockQueueManager();
    const queue = queueManager.getQueue(TELEMETRY_PULL_QUEUE);
    // Pre-seed an orphaned pull job.
    await queue.scheduleRecurring({ sourceId: "gone" }, { jobId: pullJobId("gone"), intervalSeconds: 60 });

    const reconciler = createPullReconciler({
      queueManager,
      lister: {
        listAll: async () => [
          { id: "a", sourceTypeId: PULL_QUALIFIED, enabled: true, intervalSeconds: null, satelliteId: null },
        ],
        get: async () => null,
      },
      runner,
      sourceRegistry: registryWith(),
      logger: createMockLogger(),
    });

    await reconciler.reconcileAll();
    const jobs = await queue.listRecurringJobs();
    expect(jobs).toContain(pullJobId("a"));
    expect(jobs).not.toContain(pullJobId("gone"));
  });

  it("reconcileSource cancels the job when the source is gone/disabled", async () => {
    const queueManager = createMockQueueManager();
    const queue = queueManager.getQueue(TELEMETRY_PULL_QUEUE);
    await queue.scheduleRecurring({ sourceId: "a" }, { jobId: pullJobId("a"), intervalSeconds: 60 });

    const reconciler = createPullReconciler({
      queueManager,
      lister: { listAll: async () => [], get: async () => null },
      runner,
      sourceRegistry: registryWith(),
      logger: createMockLogger(),
    });
    await reconciler.reconcileSource({ sourceId: "a" });
    expect(await queue.listRecurringJobs()).not.toContain(pullJobId("a"));
  });
});
