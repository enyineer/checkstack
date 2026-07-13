import { describe, it, expect, mock } from "bun:test";
import { ScrapeError, type AgentScrapeResult } from "./executor";
import {
  MetricScrapeScheduler,
  METRIC_SCRAPE_CAPABILITY_KIND,
  type ScrapeFn,
  type FetchSecretFn,
} from "./scheduler";
import type {
  MetricScrapeBatch,
  MetricScrapeStatus,
} from "../metric-wire";

type MetricScrapeBatchItem = MetricScrapeBatch[number];
type MetricScrapeStatusItem = MetricScrapeStatus[number];

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

const NOW = new Date("2026-07-13T00:00:00.000Z");

const flush = () => new Promise<void>((r) => setTimeout(r, 5));

const datapoint = (name: string) => ({
  name,
  type: "gauge" as const,
  labels: { job: "api" },
  value: 1,
  ts: NOW,
});

function harness(
  scrape: ScrapeFn,
  opts: { concurrency?: number; fetchSecret?: FetchSecretFn } = {},
) {
  const enqueued: { kind: string; items: MetricScrapeBatchItem[] }[] = [];
  const statuses: MetricScrapeStatusItem[] = [];
  // Default fetchSecret should never be reached by a non-bearer target; if it
  // is, the returned error makes the assertion fail loudly.
  const fetchSecret: FetchSecretFn =
    opts.fetchSecret ??
    (async () => ({ error: "fetchSecret should not have been called" }));
  const scheduler = new MetricScrapeScheduler({
    enqueue: {
      enqueue: ({ kind, items }) =>
        enqueued.push({ kind, items: items as MetricScrapeBatchItem[] }),
    },
    emitStatus: ({ payload }) =>
      statuses.push(...(payload as MetricScrapeStatusItem[])),
    fetchSecret,
    logger: noopLogger,
    scrape,
    now: () => NOW,
    concurrency: opts.concurrency ?? 4,
  });
  return { scheduler, enqueued, statuses };
}

const target = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: id,
  url: `http://${id}.local/metrics`,
  intervalSeconds: 30,
  timeoutMs: 5000,
  maxSeries: 1000,
  hasBearer: false,
  ...over,
});

describe("MetricScrapeScheduler reconcile", () => {
  it("starts a timer for each pushed target", async () => {
    const scrape = mock(async (): Promise<AgentScrapeResult> => ({
      datapoints: [],
      seriesCount: 0,
    }));
    const { scheduler } = harness(scrape);
    scheduler.applyConfig({ targets: [target("a"), target("b")] });
    expect(scheduler.activeTargetIds().sort()).toEqual(["a", "b"]);
    await flush();
    scheduler.stop();
  });

  it("removes a target dropped from a later config", async () => {
    const scrape = mock(async (): Promise<AgentScrapeResult> => ({
      datapoints: [],
      seriesCount: 0,
    }));
    const { scheduler } = harness(scrape);
    scheduler.applyConfig({ targets: [target("a"), target("b")] });
    scheduler.applyConfig({ targets: [target("a")] });
    expect(scheduler.activeTargetIds()).toEqual(["a"]);
    await flush();
    scheduler.stop();
  });

  it("does not re-scrape an unchanged target on re-push, but does on a change", async () => {
    const scrape = mock(async (): Promise<AgentScrapeResult> => ({
      datapoints: [],
      seriesCount: 0,
    }));
    const { scheduler } = harness(scrape);
    scheduler.applyConfig({ targets: [target("a")] });
    await flush();
    expect(scrape).toHaveBeenCalledTimes(1); // immediate scrape on add

    scheduler.applyConfig({ targets: [target("a")] }); // unchanged
    await flush();
    expect(scrape).toHaveBeenCalledTimes(1); // no restart, no new scrape

    scheduler.applyConfig({ targets: [target("a", { intervalSeconds: 60 })] });
    await flush();
    expect(scrape).toHaveBeenCalledTimes(2); // restart -> immediate scrape
    scheduler.stop();
  });

  it("does not start a second concurrent scrape of a target reconfigured mid-scrape", async () => {
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
    const scrape: ScrapeFn = async () => {
      calls += 1;
      active += 1;
      maxConcurrent = Math.max(maxConcurrent, active);
      signalStarted();
      await gate; // hold the first scrape in-flight
      active -= 1;
      return { datapoints: [], seriesCount: 0 };
    };
    const { scheduler } = harness(scrape);
    scheduler.applyConfig({ targets: [target("a", { intervalSeconds: 30 })] });
    await started; // the first scrape of "a" is now in-flight, blocked

    // Reconfigure the SAME target (changed interval) while its scrape awaits.
    // This replaces the ScrapeState object and fires an immediate tick; the
    // id-keyed in-flight guard must stop a second concurrent scrape of "a".
    scheduler.applyConfig({ targets: [target("a", { intervalSeconds: 45 })] });
    await flush();
    expect(calls).toBe(1);
    expect(maxConcurrent).toBe(1);

    releaseGate();
    await flush();
    scheduler.stop();
  });

  it("ignores a malformed config payload", async () => {
    const scrape = mock(async (): Promise<AgentScrapeResult> => ({
      datapoints: [],
      seriesCount: 0,
    }));
    const { scheduler } = harness(scrape);
    scheduler.applyConfig({ nope: true });
    expect(scheduler.activeTargetIds()).toEqual([]);
  });
});

describe("MetricScrapeScheduler scrape + forward", () => {
  it("forwards datapoints and emits a healthy status on success", async () => {
    const scrape = mock(async (): Promise<AgentScrapeResult> => ({
      datapoints: [datapoint("up"), datapoint("reqs")],
      seriesCount: 2,
    }));
    const { scheduler, enqueued, statuses } = harness(scrape);
    scheduler.applyConfig({ targets: [target("a")] });
    await flush();

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.kind).toBe(METRIC_SCRAPE_CAPABILITY_KIND);
    expect(enqueued[0]!.items[0]!.targetId).toBe("a");
    expect(enqueued[0]!.items[0]!.datapoints.map((d) => d.name)).toEqual([
      "up",
      "reqs",
    ]);
    // Wire datapoint carries ts as an ISO string.
    expect(typeof enqueued[0]!.items[0]!.datapoints[0]!.ts).toBe("string");

    const last = statuses.at(-1)!;
    expect(last).toMatchObject({
      targetId: "a",
      lastError: null,
      consecutiveFailures: 0,
    });
    scheduler.stop();
  });

  it("does not enqueue an empty scrape but still emits healthy status", async () => {
    const scrape = mock(async (): Promise<AgentScrapeResult> => ({
      datapoints: [],
      seriesCount: 0,
    }));
    const { scheduler, enqueued, statuses } = harness(scrape);
    scheduler.applyConfig({ targets: [target("a")] });
    await flush();
    expect(enqueued).toHaveLength(0);
    expect(statuses.at(-1)).toMatchObject({ lastError: null });
    scheduler.stop();
  });

  it("does not fetch a secret for a non-bearer target and scrapes with no bearer", async () => {
    const seen: { bearer: string | undefined } = { bearer: undefined };
    const scrape: ScrapeFn = async ({ target }) => {
      seen.bearer = target.bearerToken;
      return { datapoints: [], seriesCount: 0 };
    };
    const fetchSecret = mock<FetchSecretFn>(async () => ({}));
    const { scheduler } = harness(scrape, { fetchSecret });
    scheduler.applyConfig({ targets: [target("a", { hasBearer: false })] });
    await flush();
    expect(fetchSecret).not.toHaveBeenCalled();
    expect(seen.bearer).toBeUndefined();
    scheduler.stop();
  });

  it("fetches a bearer JIT for a bearer target and passes it to the executor, caching it across ticks", async () => {
    const seen: (string | undefined)[] = [];
    const scrape: ScrapeFn = async ({ target }) => {
      seen.push(target.bearerToken);
      return { datapoints: [], seriesCount: 0 };
    };
    const fetchSecret = mock<FetchSecretFn>(async () => ({
      payload: { bearerToken: "jit-token" },
    }));
    const { scheduler } = harness(scrape, { fetchSecret });
    scheduler.applyConfig({ targets: [target("a", { hasBearer: true })] });
    await flush();
    // Drive a second scrape without a config change: the cached token is reused.
    await scheduler.scrapeTarget("a");

    expect(fetchSecret).toHaveBeenCalledTimes(1);
    expect(fetchSecret.mock.calls[0]![0]).toEqual({
      kind: METRIC_SCRAPE_CAPABILITY_KIND,
      payload: { targetId: "a" },
    });
    expect(seen).toEqual(["jit-token", "jit-token"]);
    scheduler.stop();
  });

  it("skips the scrape (no executor call) and records lastError when the bearer is unavailable", async () => {
    const scrape = mock<ScrapeFn>(async () => ({
      datapoints: [],
      seriesCount: 0,
    }));
    const fetchSecret = mock<FetchSecretFn>(async () => ({
      error: "target not bound",
    }));
    const { scheduler, enqueued, statuses } = harness(scrape, { fetchSecret });
    scheduler.applyConfig({ targets: [target("a", { hasBearer: true })] });
    await flush();

    expect(scrape).not.toHaveBeenCalled();
    expect(enqueued).toHaveLength(0);
    expect(statuses.at(-1)).toMatchObject({
      targetId: "a",
      lastError: "bearer unavailable: target not bound",
      consecutiveFailures: 1,
    });
    scheduler.stop();
  });

  it("re-fetches the bearer after a config push (cache flush on reconfigure)", async () => {
    const scrape: ScrapeFn = async () => ({ datapoints: [], seriesCount: 0 });
    const fetchSecret = mock<FetchSecretFn>(async () => ({
      payload: { bearerToken: "jit-token" },
    }));
    const { scheduler } = harness(scrape, { fetchSecret });
    scheduler.applyConfig({ targets: [target("a", { hasBearer: true })] });
    await flush();
    expect(fetchSecret).toHaveBeenCalledTimes(1);

    // A re-push flushes the bearer cache, so the next scrape re-fetches (a
    // rotated secret must not be served from a stale cache). Changing the
    // interval restarts the target's timer -> an immediate scrape after the push.
    scheduler.applyConfig({
      targets: [target("a", { hasBearer: true, intervalSeconds: 45 })],
    });
    await flush();
    expect(fetchSecret).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it("records lastError and increments consecutiveFailures on a transport failure", async () => {
    let calls = 0;
    const scrape: ScrapeFn = async () => {
      calls += 1;
      throw new ScrapeError(`boom ${calls}`);
    };
    const { scheduler, statuses } = harness(scrape);
    scheduler.applyConfig({ targets: [target("a", { intervalSeconds: 30 })] });
    await flush();
    // Re-apply a CHANGED config to force a second immediate scrape.
    scheduler.applyConfig({ targets: [target("a", { intervalSeconds: 45 })] });
    await flush();

    const forA = statuses.filter((s) => s.targetId === "a");
    expect(forA.at(-1)).toMatchObject({
      lastError: "boom 2",
      consecutiveFailures: 2,
    });
    scheduler.stop();
  });
});
