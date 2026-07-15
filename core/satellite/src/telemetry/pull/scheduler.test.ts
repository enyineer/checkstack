import { describe, it, expect, mock } from "bun:test";
import type {
  SatellitePullExecutor,
  SatellitePullExecutorContext,
  TelemetryPullBatchEntry,
  TelemetryPullInstanceConfig,
  TelemetryPullStatus,
  WirePullRecords,
} from "@checkstack/telemetry-common";
import { TelemetryPullExecutorRegistry } from "./executor-registry";
import {
  TelemetryPullScheduler,
  TELEMETRY_PULL_CAPABILITY_KIND,
  type FetchSecretFn,
} from "./scheduler";

type TelemetryPullStatusItem = TelemetryPullStatus[number];

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

const NOW = new Date("2026-07-13T00:00:00.000Z");
const flush = () => new Promise<void>((r) => setTimeout(r, 5));

const logRecord = (body: string) => ({ ts: NOW.toISOString(), body });

const instance = (
  id: string,
  over: Partial<TelemetryPullInstanceConfig> = {},
): TelemetryPullInstanceConfig => ({
  id,
  sourceTypeId: "p.edge",
  name: id,
  intervalSeconds: 30,
  timeoutMs: 5000,
  config: { url: `https://${id}` },
  secretFields: [],
  boundSignals: ["logs"],
  ...over,
});

/** An executor that returns fixed records (default: one log). */
function fixedExecutor(
  records: WirePullRecords = { logs: [logRecord("x")] },
  over: Partial<SatellitePullExecutor> = {},
): SatellitePullExecutor {
  return {
    sourceTypeId: "p.edge",
    execute: async () => records,
    ...over,
  };
}

function harness(
  executor: SatellitePullExecutor | null,
  opts: { concurrency?: number; fetchSecret?: FetchSecretFn } = {},
) {
  const registry = new TelemetryPullExecutorRegistry();
  if (executor) registry.register(executor);
  const enqueued: { kind: string; items: TelemetryPullBatchEntry[] }[] = [];
  const statuses: TelemetryPullStatusItem[] = [];
  const fetchSecret: FetchSecretFn =
    opts.fetchSecret ??
    (async () => ({ error: "fetchSecret should not have been called" }));
  const scheduler = new TelemetryPullScheduler({
    enqueue: {
      enqueue: ({ kind, items }) =>
        enqueued.push({ kind, items: items as TelemetryPullBatchEntry[] }),
    },
    emitStatus: ({ payload }) =>
      statuses.push(...(payload as TelemetryPullStatusItem[])),
    fetchSecret,
    logger: noopLogger,
    registry,
    now: () => NOW,
    concurrency: opts.concurrency ?? 4,
  });
  return { scheduler, enqueued, statuses };
}

describe("TelemetryPullScheduler reconcile", () => {
  it("starts a timer for each pushed instance", async () => {
    const { scheduler } = harness(fixedExecutor());
    scheduler.applyConfig({ instances: [instance("a"), instance("b")] });
    expect(scheduler.activeInstanceIds().sort()).toEqual(["a", "b"]);
    await flush();
    scheduler.stop();
  });

  it("removes an instance dropped from a later config", async () => {
    const { scheduler } = harness(fixedExecutor());
    scheduler.applyConfig({ instances: [instance("a"), instance("b")] });
    scheduler.applyConfig({ instances: [instance("a")] });
    expect(scheduler.activeInstanceIds()).toEqual(["a"]);
    await flush();
    scheduler.stop();
  });

  it("does not re-run an unchanged instance on re-push, but does on a change", async () => {
    const execute = mock(async (): Promise<WirePullRecords> => ({}));
    const { scheduler } = harness(fixedExecutor(undefined, { execute }));
    scheduler.applyConfig({ instances: [instance("a")] });
    await flush();
    expect(execute).toHaveBeenCalledTimes(1); // immediate run on add

    scheduler.applyConfig({ instances: [instance("a")] }); // unchanged
    await flush();
    expect(execute).toHaveBeenCalledTimes(1); // no restart, no new run

    scheduler.applyConfig({ instances: [instance("a", { intervalSeconds: 60 })] });
    await flush();
    expect(execute).toHaveBeenCalledTimes(2); // restart -> immediate run
    scheduler.stop();
  });

  it("ignores a malformed config payload", async () => {
    const { scheduler } = harness(fixedExecutor());
    scheduler.applyConfig({ nope: true });
    expect(scheduler.activeInstanceIds()).toEqual([]);
  });

  it("does not start a second concurrent run of an instance reconfigured mid-run", async () => {
    let active = 0;
    let maxConcurrent = 0;
    let calls = 0;
    let releaseGate!: () => void;
    const gate = new Promise<void>((r) => {
      releaseGate = r;
    });
    let signalStarted!: () => void;
    const started = new Promise<void>((r) => {
      signalStarted = r;
    });
    const execute = async (): Promise<WirePullRecords> => {
      calls += 1;
      active += 1;
      maxConcurrent = Math.max(maxConcurrent, active);
      signalStarted();
      await gate;
      active -= 1;
      return {};
    };
    const { scheduler } = harness(fixedExecutor(undefined, { execute }));
    scheduler.applyConfig({ instances: [instance("a", { intervalSeconds: 30 })] });
    await started;

    scheduler.applyConfig({ instances: [instance("a", { intervalSeconds: 45 })] });
    await flush();
    expect(calls).toBe(1);
    expect(maxConcurrent).toBe(1);

    releaseGate();
    await flush();
    scheduler.stop();
  });
});

describe("TelemetryPullScheduler run + forward", () => {
  it("forwards produced records and emits a healthy status on success", async () => {
    const { scheduler, enqueued, statuses } = harness(
      fixedExecutor({ logs: [logRecord("a"), logRecord("b")] }),
    );
    scheduler.applyConfig({ instances: [instance("a")] });
    await flush();

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.kind).toBe(TELEMETRY_PULL_CAPABILITY_KIND);
    expect(enqueued[0]!.items[0]!.instanceId).toBe("a");
    expect(enqueued[0]!.items[0]!.records.logs).toHaveLength(2);

    expect(statuses.at(-1)).toMatchObject({
      instanceId: "a",
      lastError: null,
      consecutiveFailures: 0,
    });
    scheduler.stop();
  });

  it("does not enqueue an empty run but still emits healthy status", async () => {
    const { scheduler, enqueued, statuses } = harness(fixedExecutor({}));
    scheduler.applyConfig({ instances: [instance("a")] });
    await flush();
    expect(enqueued).toHaveLength(0);
    expect(statuses.at(-1)).toMatchObject({ lastError: null });
    scheduler.stop();
  });

  it("drops records for signals the instance does not route", async () => {
    const { scheduler, enqueued } = harness(
      fixedExecutor({
        logs: [logRecord("keep")],
        metrics: [
          { name: "cpu", type: "gauge", labels: {}, value: 1, ts: NOW.toISOString() },
        ],
      }),
    );
    // Bound to logs only: the metric record must be dropped before enqueue.
    scheduler.applyConfig({
      instances: [instance("a", { boundSignals: ["logs"] })],
    });
    await flush();
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.items[0]!.records.logs).toHaveLength(1);
    expect(enqueued[0]!.items[0]!.records.metrics).toBeUndefined();
    scheduler.stop();
  });

  it("emits a status error and never enqueues when the source type has no executor", async () => {
    const { scheduler, enqueued, statuses } = harness(null);
    scheduler.applyConfig({ instances: [instance("a")] });
    await flush();
    expect(enqueued).toHaveLength(0);
    expect(statuses.at(-1)).toMatchObject({
      instanceId: "a",
      lastError: "source type not available on this satellite build",
      consecutiveFailures: 1,
    });
    scheduler.stop();
  });

  it("fetches a secret JIT and passes it to the executor", async () => {
    const seen: (string | undefined)[] = [];
    const execute = async (ctx: SatellitePullExecutorContext) => {
      seen.push(await ctx.fetchSecret("apiToken"));
      return {};
    };
    const fetchSecret = mock<FetchSecretFn>(async () => ({
      payload: { value: "jit-token" },
    }));
    const { scheduler } = harness(fixedExecutor(undefined, { execute }), {
      fetchSecret,
    });
    scheduler.applyConfig({
      instances: [instance("a", { secretFields: ["apiToken"] })],
    });
    await flush();

    expect(fetchSecret.mock.calls[0]![0]).toEqual({
      kind: TELEMETRY_PULL_CAPABILITY_KIND,
      payload: { instanceId: "a", field: "apiToken" },
    });
    expect(seen).toEqual(["jit-token"]);
    scheduler.stop();
  });

  it("resolves the secret fresh each run and picks up a rotated value (no cross-run cache)", async () => {
    // Regression: a secret rotation touches no telemetry_sources row, so no
    // config is re-pushed. A cross-run cache would keep scraping with the OLD
    // value for the WS connection's lifetime; per-run resolution must re-fetch
    // and use the rotated value on the very next run.
    const seen: (string | undefined)[] = [];
    const execute = async (ctx: SatellitePullExecutorContext) => {
      seen.push(await ctx.fetchSecret("apiToken"));
      return {};
    };
    let value = "token-v1";
    const fetchSecret = mock<FetchSecretFn>(async () => ({ payload: { value } }));
    const { scheduler } = harness(fixedExecutor(undefined, { execute }), {
      fetchSecret,
    });
    scheduler.applyConfig({
      instances: [instance("a", { secretFields: ["apiToken"] })],
    });
    await flush();
    // Rotate at the source (no config re-push), then run again.
    value = "token-v2";
    await scheduler.pullInstance("a");

    expect(fetchSecret).toHaveBeenCalledTimes(2);
    expect(seen).toEqual(["token-v1", "token-v2"]);
    scheduler.stop();
  });

  it("memoizes a secret field WITHIN a single run (one request for repeated uses)", async () => {
    const execute = async (ctx: SatellitePullExecutorContext) => {
      await ctx.fetchSecret("apiToken");
      await ctx.fetchSecret("apiToken");
      return {};
    };
    const fetchSecret = mock<FetchSecretFn>(async () => ({
      payload: { value: "jit-token" },
    }));
    const { scheduler } = harness(fixedExecutor(undefined, { execute }), {
      fetchSecret,
    });
    scheduler.applyConfig({
      instances: [instance("a", { secretFields: ["apiToken"] })],
    });
    await flush();
    expect(fetchSecret).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it("records lastError and increments the absolute failure counter on a thrown run", async () => {
    let calls = 0;
    const execute = async (): Promise<WirePullRecords> => {
      calls += 1;
      throw new Error(`boom ${calls}`);
    };
    const { scheduler, statuses } = harness(fixedExecutor(undefined, { execute }));
    scheduler.applyConfig({ instances: [instance("a", { intervalSeconds: 30 })] });
    await flush();
    scheduler.applyConfig({ instances: [instance("a", { intervalSeconds: 45 })] });
    await flush();

    const forA = statuses.filter((s) => s.instanceId === "a");
    expect(forA.at(-1)).toMatchObject({
      lastError: "Error: boom 2",
      consecutiveFailures: 2,
    });
    scheduler.stop();
  });

  it("fails the run when a required secret is unavailable", async () => {
    const execute = async (ctx: SatellitePullExecutorContext) => {
      await ctx.fetchSecret("apiToken");
      return {};
    };
    const fetchSecret = mock<FetchSecretFn>(async () => ({
      error: "source not bound",
    }));
    const { scheduler, enqueued, statuses } = harness(
      fixedExecutor(undefined, { execute }),
      { fetchSecret },
    );
    scheduler.applyConfig({
      instances: [instance("a", { secretFields: ["apiToken"] })],
    });
    await flush();
    expect(enqueued).toHaveLength(0);
    expect(statuses.at(-1)).toMatchObject({
      instanceId: "a",
      lastError: "Error: secret unavailable: source not bound",
      consecutiveFailures: 1,
    });
    scheduler.stop();
  });
});
