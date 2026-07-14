/**
 * Agent-side metric-scrape scheduler. Consumes the "metric-scrape"
 * `capability_config` the core pushes (the scrape targets BOUND to this
 * satellite) and, on each tick, runs the SSRF-guarded scrape executor. Scraped
 * datapoints are forwarded as a "metric-scrape" telemetry batch; per-target
 * health is emitted as a `capability_status`. The reconcile / timer /
 * concurrency-cap / in-flight machinery and the JIT bearer-cache lifecycle live
 * in the shared {@link CapabilityIntervalScheduler}; this module supplies only
 * the metric-scrape seams.
 *
 * SECRETS: a bearer-authenticated target's token NEVER rides the pushed config;
 * it is fetched JIT and cached in memory per target, and FLUSHED on every
 * `applyConfig` (see the base's secret-cache lifecycle) so a rotated token is
 * re-fetched.
 */

import type { TelemetryEnqueuer } from "../enqueuer";
import {
  executeAgentScrape,
  ScrapeError,
  type AgentScrapeResult,
  type AgentScrapeTarget,
} from "./executor";
import {
  METRIC_SCRAPE_CAPABILITY_KIND,
  MetricScrapeConfigSchema,
  MetricScrapeSecretResponseSchema,
  toWireDatapoint,
  type MetricScrapeSecretRequest,
  type MetricScrapeStatus,
  type MetricScrapeTargetConfig,
} from "../metric-wire";
import {
  CapabilityIntervalScheduler,
  type FetchSecretFn,
  type Logger,
  type RunOutcome,
  type StatusEmitter,
} from "../interval-scheduler";

export { METRIC_SCRAPE_CAPABILITY_KIND } from "../metric-wire";
export type { FetchSecretFn, StatusEmitter } from "../interval-scheduler";

/** One per-target status update (an element of the shared status payload). */
type MetricScrapeStatusItem = MetricScrapeStatus[number];

/** Default cap on concurrent in-flight scrapes across all targets. */
export const DEFAULT_SCRAPE_CONCURRENCY = 4;

/** Injectable scrape fn (defaults to the real SSRF-guarded executor). */
export type ScrapeFn = (input: {
  target: AgentScrapeTarget;
}) => Promise<AgentScrapeResult>;

/** True when two target configs are identical for scheduling purposes. */
function sameConfig(
  a: MetricScrapeTargetConfig,
  b: MetricScrapeTargetConfig,
): boolean {
  return (
    a.url === b.url &&
    a.intervalSeconds === b.intervalSeconds &&
    a.timeoutMs === b.timeoutMs &&
    a.maxSeries === b.maxSeries &&
    a.hasBearer === b.hasBearer
  );
}

export class MetricScrapeScheduler {
  /**
   * In-memory JIT bearer cache, keyed by target id. Value is the resolved token
   * (or `undefined` when the target has no bearer). `has(id)` distinguishes
   * "already fetched" from "not yet fetched", so a resolved undefined does not
   * re-fetch every tick. NEVER persisted; flushed by the base on every
   * `applyConfig` and `stop()`.
   */
  private readonly bearerCache = new Map<string, string | undefined>();
  private readonly enqueue: TelemetryEnqueuer;
  private readonly fetchSecret: FetchSecretFn;
  private readonly scrape: ScrapeFn;
  private readonly base: CapabilityIntervalScheduler<
    MetricScrapeTargetConfig,
    MetricScrapeStatusItem
  >;

  constructor(opts: {
    enqueue: TelemetryEnqueuer;
    emitStatus: StatusEmitter;
    fetchSecret: FetchSecretFn;
    logger: Logger;
    scrape?: ScrapeFn;
    now?: () => Date;
    concurrency?: number;
  }) {
    this.enqueue = opts.enqueue;
    this.fetchSecret = opts.fetchSecret;
    this.scrape =
      opts.scrape ?? ((input) => executeAgentScrape({ target: input.target }));
    this.base = new CapabilityIntervalScheduler({
      kind: METRIC_SCRAPE_CAPABILITY_KIND,
      label: "metric-scrape",
      itemNoun: "target",
      logger: opts.logger,
      now: opts.now ?? (() => new Date()),
      concurrency: opts.concurrency ?? DEFAULT_SCRAPE_CONCURRENCY,
      emitStatus: opts.emitStatus,
      parseConfig: (payload) => {
        const parsed = MetricScrapeConfigSchema.safeParse(payload);
        return parsed.success
          ? { items: parsed.data.targets }
          : { error: parsed.error.message };
      },
      sameConfig,
      flushSecrets: () => this.bearerCache.clear(),
      runItem: ({ config }) => this.runScrape(config),
      buildStatus: ({ config, lastError, consecutiveFailures, at }) => ({
        targetId: config.id,
        lastScrapeAt: at,
        lastError,
        consecutiveFailures,
      }),
    });
  }

  /**
   * Apply a pushed "metric-scrape" capability_config (reconciles per-target
   * timers; see {@link CapabilityIntervalScheduler.applyConfig}).
   */
  applyConfig(payload: unknown): void {
    this.base.applyConfig(payload);
  }

  /** Ids of targets currently scheduled. */
  activeTargetIds(): string[] {
    return this.base.activeIds();
  }

  /** Stop every target timer and drop all in-memory secrets. */
  stop(): void {
    this.base.stop();
  }

  /**
   * Run one scrape for a target (by id), forward its datapoints, and emit
   * status. Exposed for deterministic testing (drive it instead of the timer):
   * it reuses the same in-memory bearer cache the timer path does, so a second
   * call without an intervening `applyConfig` does NOT re-fetch the secret.
   */
  async scrapeTarget(id: string): Promise<void> {
    return this.base.runOnce(id);
  }

  /**
   * The metric-scrape work for one target: resolve the bearer JIT (if any),
   * scrape, and forward datapoints. A bearer resolution failure or a transport
   * failure is returned as a failure outcome (we never scrape a bearer target
   * unauthenticated).
   */
  private async runScrape(
    config: MetricScrapeTargetConfig,
  ): Promise<RunOutcome> {
    // For a bearer-authenticated target, resolve the token JIT (cached in
    // memory). A resolution failure fails this run - we never scrape a bearer
    // target unauthenticated.
    let bearerToken: string | undefined;
    if (config.hasBearer) {
      if (this.bearerCache.has(config.id)) {
        bearerToken = this.bearerCache.get(config.id);
      } else {
        const resp = await this.fetchSecret({
          kind: METRIC_SCRAPE_CAPABILITY_KIND,
          payload: { targetId: config.id } satisfies MetricScrapeSecretRequest,
        });
        if (resp.error !== undefined) {
          return { ok: false, error: `bearer unavailable: ${resp.error}` };
        }
        const secret = MetricScrapeSecretResponseSchema.safeParse(resp.payload);
        if (!secret.success) {
          return {
            ok: false,
            error: "bearer unavailable: malformed secret response",
          };
        }
        bearerToken = secret.data.bearerToken;
        this.bearerCache.set(config.id, bearerToken);
      }
    }

    const target: AgentScrapeTarget = {
      id: config.id,
      url: config.url,
      timeoutMs: config.timeoutMs,
      maxSeries: config.maxSeries,
      ...(bearerToken === undefined ? {} : { bearerToken }),
    };

    try {
      const result = await this.scrape({ target });
      if (result.datapoints.length > 0) {
        this.enqueue.enqueue({
          kind: METRIC_SCRAPE_CAPABILITY_KIND,
          items: [
            {
              targetId: config.id,
              datapoints: result.datapoints.map((d) => toWireDatapoint(d)),
            },
          ],
          estimateBytes: estimateScrapeItemBytes,
          // A buffer drop is charged to this scrape target so the core surfaces
          // the loss on the target's stream.
          groupKeyOf: () => config.id,
        });
      }
      return { ok: true };
    } catch (error) {
      const message =
        error instanceof ScrapeError ? error.message : String(error);
      return { ok: false, error: message };
    }
  }
}

/** Approximate the serialized bytes of one "metric-scrape" batch item. */
export function estimateScrapeItemBytes(item: unknown): number {
  const typed = item as { targetId: string; datapoints: unknown[] };
  // ~48 bytes/datapoint (name + labels + value + ts) is a proportional budget;
  // avoids an O(payload) JSON.stringify on every telemetry push.
  return typed.targetId.length + 16 + typed.datapoints.length * 48;
}
