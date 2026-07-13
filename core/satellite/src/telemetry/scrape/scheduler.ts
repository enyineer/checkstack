/**
 * Agent-side metric-scrape scheduler. Consumes the "metric-scrape"
 * `capability_config` the core pushes (the scrape targets BOUND to this
 * satellite), maintains one interval timer per target (reconciled on every
 * push, mirroring the health-assignment scheduler), and on each tick runs the
 * SSRF-guarded scrape executor. Scraped datapoints are forwarded as a
 * "metric-scrape" telemetry batch; per-target health (`lastScrapeAt`,
 * `lastError`, `consecutiveFailures`) is emitted as a `capability_status`.
 *
 * BACKPRESSURE: at most `concurrency` scrapes run at once (a satellite with many
 * targets cannot open unbounded sockets); a tick that would exceed the cap, or
 * that races a still-in-flight scrape of the SAME target, is skipped and retried
 * on the next interval. Datapoints ride the telemetry client's bounded,
 * drop-oldest buffers, so a slow/offline core cannot grow memory here.
 *
 * STATE & SCALE: timers + counters are pod-local transport bookkeeping on a
 * single agent process. The durable record (target rows, series buckets) lives
 * in the core's metricstream tables; the binding is re-pushed on every connect.
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

export { METRIC_SCRAPE_CAPABILITY_KIND } from "../metric-wire";

/** One per-target status update (an element of the shared status payload). */
type MetricScrapeStatusItem = MetricScrapeStatus[number];

/** Default cap on concurrent in-flight scrapes across all targets. */
export const DEFAULT_SCRAPE_CONCURRENCY = 4;

interface Logger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  debug: (msg: string) => void;
}

/** Emitter for a `capability_status` update (the agent capability registry). */
export type StatusEmitter = (input: { kind: string; payload: unknown }) => void;

/** Injectable scrape fn (defaults to the real SSRF-guarded executor). */
export type ScrapeFn = (input: {
  target: AgentScrapeTarget;
}) => Promise<AgentScrapeResult>;

/**
 * Fetch a capability secret JIT (bound to `SatelliteClient.requestCapabilitySecret`
 * in production; injected for tests). Resolves a verdict object - `payload` on
 * success, `error` on failure - and never throws.
 */
export type FetchSecretFn = (input: {
  kind: string;
  payload: unknown;
}) => Promise<{ payload?: unknown; error?: string }>;

interface ScrapeState {
  config: MetricScrapeTargetConfig;
  timer: ReturnType<typeof setInterval> | undefined;
  consecutiveFailures: number;
}

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
  private readonly targets = new Map<string, ScrapeState>();
  private inFlightCount = 0;
  /**
   * Ids of targets with a scrape in flight, tracked at the SCHEDULER level (not
   * on the per-target ScrapeState). A mid-scrape `applyConfig` replaces a
   * changed target's ScrapeState object, so a guard keyed on the state instance
   * would be defeated - the new tick would run a SECOND concurrent scrape of the
   * same id (double bearer fetch, duplicate datapoints + status). Keying on the
   * stable id survives the replacement.
   */
  private readonly inFlightTargetIds = new Set<string>();
  /**
   * In-memory JIT bearer cache, keyed by target id. Value is the resolved token
   * (or `undefined` when the target has no bearer). `has(id)` distinguishes
   * "already fetched" from "not yet fetched", so a resolved undefined does not
   * re-fetch every tick. NEVER persisted; cleared on every `applyConfig` (so a
   * ROTATED secret - which re-pushes an identical config - is re-fetched) and on
   * `stop()`.
   */
  private readonly bearerCache = new Map<string, string | undefined>();
  private readonly enqueue: TelemetryEnqueuer;
  private readonly emitStatus: StatusEmitter;
  private readonly fetchSecret: FetchSecretFn;
  private readonly logger: Logger;
  private readonly scrape: ScrapeFn;
  private readonly now: () => Date;
  private readonly concurrency: number;

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
    this.emitStatus = opts.emitStatus;
    this.fetchSecret = opts.fetchSecret;
    this.logger = opts.logger;
    this.scrape =
      opts.scrape ?? ((input) => executeAgentScrape({ target: input.target }));
    this.now = opts.now ?? (() => new Date());
    this.concurrency = opts.concurrency ?? DEFAULT_SCRAPE_CONCURRENCY;
  }

  /**
   * Apply a pushed "metric-scrape" capability_config. Validates the payload and
   * reconciles timers: unchanged targets keep running, changed targets restart,
   * removed targets stop, new targets start (with an immediate first scrape).
   */
  applyConfig(payload: unknown): void {
    const parsed = MetricScrapeConfigSchema.safeParse(payload);
    if (!parsed.success) {
      this.logger.warn(
        `satellite: malformed metric-scrape config; ignoring (${parsed.error.message})`,
      );
      return;
    }
    // Flush the JIT bearer cache on every push: a secret ROTATION re-pushes an
    // otherwise-identical config (sameConfig sees no change), so clearing here -
    // an infrequent event (connect + target CRUD) - guarantees the next scrape
    // re-fetches the rotated token, and drops entries for removed targets.
    this.bearerCache.clear();
    const next = new Map(parsed.data.targets.map((t) => [t.id, t]));

    // Stop timers for removed targets.
    for (const [id, state] of this.targets) {
      if (!next.has(id)) {
        if (state.timer) clearInterval(state.timer);
        this.targets.delete(id);
        this.logger.debug(`satellite: stopped scrape for target ${id}`);
      }
    }

    // Add or restart timers for new / changed targets.
    for (const config of next.values()) {
      const existing = this.targets.get(config.id);
      if (existing && sameConfig(existing.config, config)) continue;

      if (existing?.timer) clearInterval(existing.timer);
      const state: ScrapeState = {
        config,
        timer: undefined,
        consecutiveFailures: existing?.consecutiveFailures ?? 0,
      };
      this.targets.set(config.id, state);
      // Immediate first scrape, then on the interval.
      void this.tick(config.id);
      state.timer = setInterval(
        () => void this.tick(config.id),
        config.intervalSeconds * 1000,
      );
      this.logger.debug(
        `satellite: scraping target ${config.id} every ${config.intervalSeconds}s`,
      );
    }

    this.logger.info(
      `satellite: metric-scrape targets active: ${this.targets.size}`,
    );
  }

  /** Ids of targets currently scheduled. */
  activeTargetIds(): string[] {
    return [...this.targets.keys()];
  }

  /** Stop every target timer and drop all in-memory secrets. */
  stop(): void {
    for (const state of this.targets.values()) {
      if (state.timer) clearInterval(state.timer);
    }
    this.targets.clear();
    this.bearerCache.clear();
  }

  /**
   * One scheduled tick for a target: enforce the concurrency cap + per-target
   * in-flight guard, then run the scrape. Skips (retried next interval) rather
   * than queueing when saturated.
   */
  private async tick(id: string): Promise<void> {
    const state = this.targets.get(id);
    if (!state) return;
    // Guard by target id (not the ScrapeState instance): a mid-scrape
    // applyConfig replaces the state object, so an instance-keyed guard would let
    // a concurrent scrape of the same id through.
    if (this.inFlightTargetIds.has(id)) return;
    if (this.inFlightCount >= this.concurrency) {
      this.logger.debug(
        `satellite: scrape concurrency cap reached; skipping ${id} this tick`,
      );
      return;
    }
    this.inFlightTargetIds.add(id);
    this.inFlightCount += 1;
    try {
      await this.scrapeTarget(id);
    } finally {
      this.inFlightTargetIds.delete(id);
      this.inFlightCount -= 1;
    }
  }

  /**
   * Run one scrape for a target (by id), forward its datapoints, and emit
   * status. Exposed for deterministic testing (drive it instead of the timer):
   * it reuses the same in-memory bearer cache the timer path does, so a second
   * call without an intervening `applyConfig` does NOT re-fetch the secret. A
   * transport failure is recorded as `lastError` and increments
   * `consecutiveFailures`; a success resets the failure counter.
   */
  async scrapeTarget(id: string): Promise<void> {
    const state = this.targets.get(id);
    if (!state) return;
    const { config } = state;

    // For a bearer-authenticated target, resolve the token JIT (cached in
    // memory). A resolution failure SKIPS this scrape - we never scrape a bearer
    // target unauthenticated - and surfaces as lastError + a failure increment.
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
          this.recordFailure(state, `bearer unavailable: ${resp.error}`);
          return;
        }
        const secret = MetricScrapeSecretResponseSchema.safeParse(resp.payload);
        if (!secret.success) {
          this.recordFailure(state, "bearer unavailable: malformed secret response");
          return;
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
      state.consecutiveFailures = 0;
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
      this.emit({
        targetId: config.id,
        lastScrapeAt: this.now().toISOString(),
        lastError: null,
        consecutiveFailures: 0,
      });
    } catch (error) {
      const message =
        error instanceof ScrapeError ? error.message : String(error);
      this.recordFailure(state, message);
    }
  }

  /** Increment the failure counter, log, and emit a failing per-target status. */
  private recordFailure(state: ScrapeState, message: string): void {
    state.consecutiveFailures += 1;
    this.logger.debug(
      `satellite: scrape of ${state.config.id} failed (${state.consecutiveFailures}): ${message}`,
    );
    this.emit({
      targetId: state.config.id,
      lastScrapeAt: this.now().toISOString(),
      lastError: message,
      consecutiveFailures: state.consecutiveFailures,
    });
  }

  private emit(status: MetricScrapeStatusItem): void {
    this.emitStatus({
      kind: METRIC_SCRAPE_CAPABILITY_KIND,
      payload: [status],
    });
  }
}

/** Approximate the serialized bytes of one "metric-scrape" batch item. */
export function estimateScrapeItemBytes(item: unknown): number {
  const typed = item as { targetId: string; datapoints: unknown[] };
  // ~48 bytes/datapoint (name + labels + value + ts) is a proportional budget;
  // avoids an O(payload) JSON.stringify on every telemetry push.
  return typed.targetId.length + 16 + typed.datapoints.length * 48;
}
