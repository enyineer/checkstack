import { extractErrorMessage } from "@checkstack/common";
import type { Logger } from "@checkstack/common";
import type { TemplateContext } from "@checkstack/template-engine";
import {
  renderTemplatableConfig,
  type CollectorResult,
  type CollectorRunContext,
  type RegisteredCollector,
  type HealthCheckStrategy,
  type TransportTimings,
} from "@checkstack/backend-api";

/**
 * The shared health-check execution engine used by BOTH the core queue
 * executor and the satellite agent.
 *
 * ## Why this is shared
 *
 * The two executors run in different worlds - the core resolves secrets from
 * its database and persists runs to Postgres; the satellite resolves secrets
 * just-in-time over its socket and buffers a result message back - but the
 * MIDDLE of a run is identical: render the templatable config against the run's
 * environment/system context, build the transport client, run each collector,
 * and assemble a pass/fail outcome.
 *
 * That middle used to be a hand-maintained COPY in each executor, and the copies
 * drifted: when the core grew the `{{ environment.* }}` / `{{ system.metadata.*
 * }}` templating pass, the satellite copy was never updated, so custom-field
 * templates silently rendered to nothing on satellite runs. Sharing the middle
 * makes that class of drift impossible - the templating pass runs here, once,
 * for both callers.
 *
 * ## The shared invariant vs the injected edges
 *
 * This engine owns the INVARIANT sequence that must never differ between
 * callers, in this order:
 *
 * 1. render the strategy config's `x-templatable` fields, then build the client;
 * 2. per collector: resolve its secrets, prepare its config, **render its
 *    `x-templatable` fields**, execute it;
 * 3. assemble the pass/fail outcome, and always close the client.
 *
 * Everything that genuinely differs between the core and the satellite is an
 * injected hook, so each caller keeps its own secret sourcing and result
 * post-processing without being able to reorder or skip the shared steps:
 *
 * - `resolveSecretEnv` - where a collector's secret env comes from (DB resolver
 *   vs JIT socket fetch).
 * - `prepareCollectorConfig` - how the pre-template config is obtained (the core
 *   inflates + migrates; the satellite applies its relayed override or the raw
 *   entry).
 * - `mapResult` / `mapError` - what a finished collector result becomes (the
 *   core evaluates assertions, strips ephemeral fields, and annotates; the
 *   satellite passes the raw result through and lets the core evaluate
 *   assertions on ingest).
 *
 * The engine feeds each caller's `prepareCollectorConfig` output through the
 * shared templating pass BEFORE execution, so a hook cannot accidentally skip
 * templating - which is exactly the bug that motivated this module.
 */

/**
 * Build the templating context for a run from its curated run-context. Shared
 * so the core and satellite render `{{ environment.* }}` / `{{ system.* }}`
 * against byte-identical inputs.
 *
 * `environment` is the resolved environment's verbatim custom fields (or `{}`
 * for an env-less run, so a reference renders to empty string rather than
 * throwing); `check` and `system` carry the curated structural metadata,
 * exposing `{{ system.metadata.<key> }}` for system custom fields.
 */
export function buildTemplateContext(
  runContext: CollectorRunContext,
): TemplateContext {
  return {
    environment: runContext.environment?.fields ?? {},
    check: runContext.check,
    system: runContext.system,
  };
}

/** A collector's finished, storage-ready outcome. */
export interface CollectorOutcome {
  /** Key under which {@link storedResult} is filed in `collectorResults`. */
  storageKey: string;
  /** False when this collector failed (threw, errored, or failed an assertion). */
  success: boolean;
  /** The failure message when `success` is false; drives the run's error. */
  error?: string;
  /** The value stored under `storageKey`, already post-processed by the caller. */
  storedResult: Record<string, unknown>;
}

/** The result of running a check's transport + collectors, sink-agnostic. */
export interface HealthCheckCollectionOutcome {
  /** Whether the transport client was successfully built. */
  connected: boolean;
  /**
   * True when the sequence itself threw or timed out (the client could not be
   * built, or a hard timeout fired) - as opposed to completing with some
   * collector reporting a failure. Callers that render a distinct
   * transport-failure result (the core) branch on this; a caller that treats
   * both the same (the satellite) can ignore it.
   */
  aborted: boolean;
  /** Time to build the client, when it was built. */
  connectionTimeMs?: number;
  /**
   * The transport client's surfaced sub-phase timings (DNS / connect / TLS /
   * ...), captured before the client was closed. Present only when the strategy
   * populated them; callers lift it into the run's `metadata.timings`.
   */
  clientTimings?: TransportTimings;
  /** Total wall time of the build + collect sequence. */
  latencyMs: number;
  /** Whether any collector failed (or the sequence threw/timed out). */
  hasCollectorError: boolean;
  /** The first failure message, when there was one. */
  errorMessage?: string;
  /** Each non-skipped collector's stored result, keyed by its storage key. */
  collectorResults: Record<string, unknown>;
}

/** Injected, caller-specific edges around the shared execution sequence. */
export interface HealthCheckCollectionHooks<TEntry> {
  /** Resolve the registered collector for an entry (both callers share the registry). */
  getCollector(entry: TEntry): RegisteredCollector | undefined;
  /** The storage key an entry's result is filed under. */
  storageKeyOf(entry: TEntry): string;
  /**
   * Resolve this collector's declared secret env for the run, or `undefined`
   * when it declares none. Runs BEFORE the config is prepared and templated, so
   * `${{ secrets.* }}` (a separate channel) is always resolved before
   * `{{ ... }}` templating.
   */
  resolveSecretEnv?(
    entry: TEntry,
    registered: RegisteredCollector,
  ): Promise<Record<string, string> | undefined>;
  /**
   * Produce the collector's final PRE-TEMPLATE config: secret-resolved and (on
   * the core) migrated. The engine then renders its `x-templatable` fields and
   * executes it - the hook must not do the templating itself.
   */
  prepareCollectorConfig(
    entry: TEntry,
    registered: RegisteredCollector,
  ): Promise<Record<string, unknown>>;
  /** Turn a successful collector result into its stored outcome. */
  mapResult(args: {
    entry: TEntry;
    registered: RegisteredCollector;
    collectorResult: CollectorResult<unknown>;
  }): CollectorOutcome;
  /** Turn a collector that threw into its stored (failed) outcome. */
  mapError(args: {
    entry: TEntry;
    registered: RegisteredCollector;
    error: unknown;
  }): CollectorOutcome;
}

export interface RunHealthCheckCollectionParams<TEntry> {
  strategy: HealthCheckStrategy;
  /**
   * The strategy config, already secret-resolved by the caller. The engine
   * renders its `x-templatable` fields before building the client.
   */
  strategyConfig: unknown;
  collectors: TEntry[];
  runContext: CollectorRunContext;
  /** The transport strategy id, passed to each collector as `pluginId`. */
  pluginId: string;
  logger: Logger;
  /**
   * Optional hard timeout (ms) wrapping the whole build + collect sequence. The
   * core passes its per-check timeout; the satellite passes none (its scheduler
   * bounds runs separately). On timeout the outcome reports the failure and the
   * client is still closed.
   */
  timeoutMs?: number;
  hooks: HealthCheckCollectionHooks<TEntry>;
}

/**
 * Run one health check's transport + collectors for ONE resolved environment,
 * returning a sink-agnostic {@link HealthCheckCollectionOutcome}. The caller
 * turns that into a persisted run (core) or a result message (satellite).
 */
export async function runHealthCheckCollection<TEntry>({
  strategy,
  strategyConfig,
  collectors,
  runContext,
  pluginId,
  logger,
  timeoutMs,
  hooks,
}: RunHealthCheckCollectionParams<TEntry>): Promise<HealthCheckCollectionOutcome> {
  const templateContext = buildTemplateContext(runContext);
  const start = performance.now();

  let connected = false;
  let connectionTimeMs: number | undefined;
  let connectedClient:
    | Awaited<ReturnType<HealthCheckStrategy["createClient"]>>
    | undefined;
  const collectorResults: Record<string, unknown> = {};
  let hasCollectorError = false;
  let errorMessage: string | undefined;

  // Captured before `close()` in the finally, so a caller can lift the
  // strategy's sub-phase timings even though the engine owns the client. Only
  // present, finite, non-negative phases survive, so a caller can store the
  // result directly as `metadata.timings` (an all-empty timings object becomes
  // `undefined` and is omitted).
  const readClientTimings = (): TransportTimings | undefined => {
    const raw = connectedClient?.timings;
    if (!raw) return undefined;
    const filtered: TransportTimings = {};
    let any = false;
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        filtered[key as keyof TransportTimings] = value;
        any = true;
      }
    }
    return any ? filtered : undefined;
  };

  try {
    const work = (async () => {
      // (1) Render the strategy config's templatable fields, THEN connect - so
      // each environment/system gets its own rendered client config.
      const renderedStrategyConfig = renderTemplatableConfig({
        config: strategyConfig,
        schema: strategy.config.schema,
        context: templateContext,
      });
      connectedClient = await strategy.createClient(renderedStrategyConfig);
      connected = true;
      connectionTimeMs = Math.round(performance.now() - start);

      // (2) Run collectors in parallel. Each collector's config is templated
      // HERE, after the caller's secret/prepare hooks, so the render pass can
      // never be skipped by a caller.
      const settled = await Promise.allSettled(
        collectors.map(
          async (entry): Promise<CollectorOutcome | { skipped: true }> => {
            const registered = hooks.getCollector(entry);
            const storageKey = hooks.storageKeyOf(entry);
            if (!registered) {
              logger.warn(
                `Collector for entry ${storageKey} not found, skipping`,
              );
              return { skipped: true };
            }
            try {
              const secretEnv = await hooks.resolveSecretEnv?.(
                entry,
                registered,
              );
              const preparedConfig = await hooks.prepareCollectorConfig(
                entry,
                registered,
              );
              const renderedConfig = renderTemplatableConfig({
                config: preparedConfig,
                schema: registered.collector.config.schema,
                context: templateContext,
              });
              const collectorResult = await registered.collector.execute({
                config: renderedConfig,
                client: connectedClient!.client,
                pluginId,
                runContext,
                ...(secretEnv ? { secretEnv } : {}),
              });
              return hooks.mapResult({ entry, registered, collectorResult });
            } catch (error) {
              return hooks.mapError({ entry, registered, error });
            }
          },
        ),
      );

      for (const outcome of settled) {
        if (outcome.status === "rejected") {
          // The per-collector body catches its own errors, so this is a
          // defensive path; treat it as a collector failure.
          hasCollectorError = true;
          if (!errorMessage) errorMessage = String(outcome.reason);
          continue;
        }
        const value = outcome.value;
        if ("skipped" in value) continue;
        collectorResults[value.storageKey] = value.storedResult;
        if (!value.success || value.error) {
          hasCollectorError = true;
          if (!errorMessage) errorMessage = value.error;
        }
      }
    })();

    await (timeoutMs === undefined
      ? work
      : Promise.race([
          work,
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`Execution timeout after ${timeoutMs}ms`)),
              timeoutMs,
            ),
          ),
        ]));
  } catch (error) {
    // A thrown build (createClient) or a timeout lands here. `connected`
    // reflects whether the client was built, mirroring the pre-extraction
    // executors' `metadata.connected`.
    return {
      connected,
      aborted: true,
      connectionTimeMs,
      clientTimings: readClientTimings(),
      latencyMs: Math.round(performance.now() - start),
      hasCollectorError: true,
      errorMessage: errorMessage ?? extractErrorMessage(error),
      collectorResults,
    };
  } finally {
    try {
      connectedClient?.close();
    } catch {
      // Best-effort close; a failed teardown must not mask the run outcome.
    }
  }

  return {
    connected,
    aborted: false,
    connectionTimeMs,
    clientTimings: readClientTimings(),
    latencyMs: Math.round(performance.now() - start),
    hasCollectorError,
    errorMessage,
    collectorResults,
  };
}
