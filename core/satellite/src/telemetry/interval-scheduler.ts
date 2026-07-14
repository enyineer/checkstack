/**
 * Shared agent-side interval scheduler for a pushed capability. Both the
 * metric-scrape and telemetry-pull schedulers are the SAME machine: consume a
 * pushed `capability_config` (the items BOUND to this satellite), maintain one
 * interval timer per item (reconciled on every push), run the item's work on
 * each tick, forward its output, and emit per-item health as a
 * `capability_status`. Only the config schema, the equality check, the per-tick
 * work, the secret cache, and the status shape differ - those are the SEAMS a
 * concrete scheduler supplies via {@link CapabilityIntervalSchedulerOptions}.
 *
 * BACKPRESSURE: at most `concurrency` runs at once; a tick that would exceed the
 * cap, or that races a still-in-flight run of the SAME item, is skipped and
 * retried on the next interval (never queued). Output rides the telemetry
 * client's bounded, drop-oldest buffers, so a slow/offline core cannot grow
 * memory here.
 *
 * STABLE-ID IN-FLIGHT GUARD: ids of items with a run in flight are tracked at
 * the SCHEDULER level, keyed on the STABLE id - NOT on the per-item state
 * object. A mid-run `applyConfig` replaces a changed item's state object, so a
 * guard keyed on the state instance would be defeated: the new tick would spawn
 * a SECOND concurrent run of the same id (double secret fetch, duplicate
 * output + status). Keying on the id survives the replacement.
 *
 * SECRETS: config secret fields NEVER ride the pushed config; the item's work
 * fetches each JIT and caches it in the concrete scheduler's own store. That
 * store is FLUSHED on every `applyConfig` (via the `flushSecrets` seam) so a
 * ROTATED secret - which re-pushes an otherwise-identical config that
 * `sameConfig` sees as unchanged - is re-fetched, and on `stop()`.
 *
 * STATE & SCALE: timers + counters (+ the concrete scheduler's secret cache)
 * are pod-local transport bookkeeping on a single agent process. The durable
 * record lives in the core's tables; the binding is re-pushed on every connect.
 */

/** Structured logger the scheduler writes progress/health to. */
export interface Logger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  debug: (msg: string) => void;
}

/** Emitter for a `capability_status` update (the agent capability registry). */
export type StatusEmitter = (input: { kind: string; payload: unknown }) => void;

/**
 * Fetch a capability secret JIT (bound to `SatelliteClient.requestCapabilitySecret`
 * in production; injected for tests). Resolves a verdict object - `payload` on
 * success, `error` on failure - and never throws.
 */
export type FetchSecretFn = (input: {
  kind: string;
  payload: unknown;
}) => Promise<{ payload?: unknown; error?: string }>;

/** Minimum config shape every scheduled item must expose. */
export interface IntervalSchedulerItem {
  id: string;
  intervalSeconds: number;
}

/** Outcome of one item run: success, or a failure carrying its error message. */
export type RunOutcome = { ok: true } | { ok: false; error: string };

/** Parsed capability_config: the item configs, or a validation error message. */
export type ParsedConfig<Config> = { items: Config[] } | { error: string };

interface ItemState<Config> {
  config: Config;
  timer: ReturnType<typeof setInterval> | undefined;
  consecutiveFailures: number;
}

/** The concrete-scheduler seams the generic machine is parameterized by. */
export interface CapabilityIntervalSchedulerOptions<
  Config extends IntervalSchedulerItem,
  StatusItem,
> {
  /** `capability_status` kind (also the status payload's kind). */
  kind: string;
  /** Log label for this capability (e.g. `"telemetry-pull"`). */
  label: string;
  /** Singular noun for one item in logs (e.g. `"source"`, `"target"`). */
  itemNoun: string;
  logger: Logger;
  now: () => Date;
  concurrency: number;
  emitStatus: StatusEmitter;
  /** Validate a pushed config payload into item configs (or a parse error). */
  parseConfig: (payload: unknown) => ParsedConfig<Config>;
  /** True when two configs are identical for scheduling (no restart needed). */
  sameConfig: (a: Config, b: Config) => boolean;
  /** Drop all cached JIT secrets (called on every `applyConfig` and `stop`). */
  flushSecrets: () => void;
  /** Run one item's work: forward its output and return the run outcome. */
  runItem: (args: { config: Config }) => Promise<RunOutcome>;
  /** Build the concrete per-item status payload from a run outcome. */
  buildStatus: (args: {
    config: Config;
    lastError: string | null;
    consecutiveFailures: number;
    at: string;
  }) => StatusItem;
}

export class CapabilityIntervalScheduler<
  Config extends IntervalSchedulerItem,
  StatusItem,
> {
  private readonly items = new Map<string, ItemState<Config>>();
  private inFlightCount = 0;
  /** See STABLE-ID IN-FLIGHT GUARD in the file header. */
  private readonly inFlightIds = new Set<string>();
  private readonly opts: CapabilityIntervalSchedulerOptions<Config, StatusItem>;

  constructor(opts: CapabilityIntervalSchedulerOptions<Config, StatusItem>) {
    this.opts = opts;
  }

  /**
   * Apply a pushed capability_config. Validates the payload and reconciles
   * timers: unchanged items keep running, changed items restart, removed items
   * stop, new items start (with an immediate first run).
   */
  applyConfig(payload: unknown): void {
    const parsed = this.opts.parseConfig(payload);
    if ("error" in parsed) {
      this.opts.logger.warn(
        `satellite: malformed ${this.opts.label} config; ignoring (${parsed.error})`,
      );
      return;
    }
    // Flush the JIT secret cache on every push: a secret ROTATION re-pushes an
    // otherwise-identical config (sameConfig sees no change), so clearing here -
    // an infrequent event (connect + item CRUD) - guarantees the next run
    // re-fetches the rotated secret, and drops entries for removed items.
    this.opts.flushSecrets();
    const next = new Map(parsed.items.map((i) => [i.id, i]));

    // Stop timers for removed items.
    for (const [id, state] of this.items) {
      if (!next.has(id)) {
        if (state.timer) clearInterval(state.timer);
        this.items.delete(id);
        this.opts.logger.debug(
          `satellite: stopped ${this.opts.label} ${this.opts.itemNoun} ${id}`,
        );
      }
    }

    // Add or restart timers for new / changed items.
    for (const config of next.values()) {
      const existing = this.items.get(config.id);
      if (existing && this.opts.sameConfig(existing.config, config)) continue;

      if (existing?.timer) clearInterval(existing.timer);
      const state: ItemState<Config> = {
        config,
        timer: undefined,
        consecutiveFailures: existing?.consecutiveFailures ?? 0,
      };
      this.items.set(config.id, state);
      // Immediate first run, then on the interval.
      void this.tick(config.id);
      state.timer = setInterval(
        () => void this.tick(config.id),
        config.intervalSeconds * 1000,
      );
      this.opts.logger.debug(
        `satellite: ${this.opts.label} ${this.opts.itemNoun} ${config.id} every ${config.intervalSeconds}s`,
      );
    }

    this.opts.logger.info(
      `satellite: ${this.opts.label} ${this.opts.itemNoun}s active: ${this.items.size}`,
    );
  }

  /** Ids of items currently scheduled. */
  activeIds(): string[] {
    return [...this.items.keys()];
  }

  /** Stop every timer and drop all in-memory secrets. */
  stop(): void {
    for (const state of this.items.values()) {
      if (state.timer) clearInterval(state.timer);
    }
    this.items.clear();
    this.opts.flushSecrets();
  }

  /**
   * One scheduled tick for an item: enforce the concurrency cap + per-item
   * in-flight guard, then run it. Skips (retried next interval) rather than
   * queueing when saturated.
   */
  private async tick(id: string): Promise<void> {
    const state = this.items.get(id);
    if (!state) return;
    if (this.inFlightIds.has(id)) return;
    if (this.inFlightCount >= this.opts.concurrency) {
      this.opts.logger.debug(
        `satellite: ${this.opts.label} concurrency cap reached; skipping ${id} this tick`,
      );
      return;
    }
    this.inFlightIds.add(id);
    this.inFlightCount += 1;
    try {
      await this.runOnce(id);
    } finally {
      this.inFlightIds.delete(id);
      this.inFlightCount -= 1;
    }
  }

  /**
   * Run one item's work by id, then record its outcome as a per-item status. A
   * failure increments `consecutiveFailures`; a success resets it. Exposed for
   * deterministic testing (drive it instead of the timer): the concrete
   * scheduler's `runItem` reuses the same in-memory secret cache the timer path
   * does, so a second call without an intervening `applyConfig` does NOT
   * re-fetch the secret.
   */
  async runOnce(id: string): Promise<void> {
    const state = this.items.get(id);
    if (!state) return;
    const outcome = await this.opts.runItem({ config: state.config });
    const at = this.opts.now().toISOString();
    if (outcome.ok) {
      state.consecutiveFailures = 0;
      this.emit(
        this.opts.buildStatus({
          config: state.config,
          lastError: null,
          consecutiveFailures: 0,
          at,
        }),
      );
      return;
    }
    state.consecutiveFailures += 1;
    this.opts.logger.debug(
      `satellite: ${this.opts.label} of ${this.opts.itemNoun} ${id} failed (${state.consecutiveFailures}): ${outcome.error}`,
    );
    this.emit(
      this.opts.buildStatus({
        config: state.config,
        lastError: outcome.error,
        consecutiveFailures: state.consecutiveFailures,
        at,
      }),
    );
  }

  private emit(status: StatusItem): void {
    this.opts.emitStatus({ kind: this.opts.kind, payload: [status] });
  }
}
