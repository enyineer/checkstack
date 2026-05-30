/**
 * Live-state pre-resolution for the sensing layer (Wave 2 Phase 14).
 *
 * The template engine is strictly synchronous and has no call syntax, so
 * a template can never query the database inline. Instead, live health
 * state is resolved up front (one batched query per evaluation) and
 * folded into the scope under a `health` namespace, then read as plain
 * data: `{{ health.system.status }}`, `{{ health.system.in_status_since }}`.
 *
 * This mirrors `resolveConsumedArtifacts` (which awaits the artifact
 * store and folds the result into scope before an action runs) and HA's
 * approach of resolving trigger entities up front rather than lazily.
 *
 * Resolution policy (decision D2): implicitly resolve the system named by
 * the trigger's `contextKey`, plus any ids listed in the automation's
 * `uses_state` escape hatch. The resolved set is bounded; truncation is
 * logged, never silent.
 */
import type { Logger } from "@checkstack/backend-api";
import type { InferClient } from "@checkstack/common";
import type { HealthCheckApi } from "@checkstack/healthcheck-common";

type HealthCheckClient = InferClient<typeof HealthCheckApi>;

/**
 * Hard cap on systems resolved per evaluation. `uses_state` is already
 * schema-capped at 50; this is the runtime backstop including the
 * implicit context system.
 */
export const MAX_RESOLVED_SYSTEMS = 50;

/** snake_case state shape exposed to templates under `health.*`. */
export interface ScopeHealthState {
  status: string;
  in_status_since: string | null;
  in_status_for_ms: number;
  latency_ms?: number;
  avg_latency_ms?: number;
  p95_latency_ms?: number;
  success_rate?: number;
  last_run_at?: string;
  in_maintenance: boolean;
  evaluated_at: string;
}

/** The `health` namespace folded into scope. */
export interface ScopeHealthNamespace {
  /** State of the system named by the trigger's contextKey, if resolvable. */
  system?: ScopeHealthState;
  /** State of every resolved system, keyed by system id. */
  systems: Record<string, ScopeHealthState>;
}

/**
 * Map a wire `HealthStateResponse` (Date fields, camelCase) into the
 * snake_case, ISO-string shape templates read. ISO strings (not Date
 * objects) so the duration filters (`older_than`, `duration_since`)
 * receive parseable values and snapshots serialise cleanly.
 */
function toScopeState(state: {
  status: string;
  inStatusSince: Date | string | null;
  inStatusForMs: number;
  latencyMs?: number;
  avgLatencyMs?: number;
  p95LatencyMs?: number;
  successRate?: number;
  lastRunAt?: Date | string;
  inMaintenance: boolean;
  evaluatedAt: Date | string;
}): ScopeHealthState {
  const iso = (v: Date | string | null | undefined): string | undefined => {
    if (v == null) return undefined;
    return v instanceof Date ? v.toISOString() : v;
  };
  return {
    status: state.status,
    in_status_since: iso(state.inStatusSince) ?? null,
    in_status_for_ms: state.inStatusForMs,
    latency_ms: state.latencyMs,
    avg_latency_ms: state.avgLatencyMs,
    p95_latency_ms: state.p95LatencyMs,
    success_rate: state.successRate,
    last_run_at: iso(state.lastRunAt),
    in_maintenance: state.inMaintenance,
    evaluated_at: iso(state.evaluatedAt) ?? new Date().toISOString(),
  };
}

export interface EnrichScopeArgs {
  /** The mutable scope to fold `health` into. Returned for convenience. */
  scope: Record<string, unknown>;
  client: HealthCheckClient | undefined;
  logger: Logger;
  /** Resolved trigger context key — treated as the implicit system id. */
  contextKey: string | null;
  /** Extra system ids from the automation's `uses_state` escape hatch. */
  usesState?: ReadonlyArray<string>;
}

/**
 * Resolve live health state for the implicit context system + any
 * `uses_state` ids and fold it into `scope.health`. One batched
 * `getBulkHealthState` call. Fail-open: a missing client or a provider
 * error yields an empty `health` namespace and a warn-log — a
 * healthcheck outage never wedges unrelated automations.
 */
export async function enrichScopeWithState(
  args: EnrichScopeArgs,
): Promise<Record<string, unknown>> {
  const { scope, client, logger, contextKey, usesState } = args;

  // Build the bounded, de-duplicated id set: implicit context system first.
  const ids: string[] = [];
  const seen = new Set<string>();
  const add = (id: string) => {
    if (id.length === 0 || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };
  if (contextKey) add(contextKey);
  for (const id of usesState ?? []) add(id);

  // Nothing to resolve, or no client wired — still expose an empty
  // namespace so templates referencing `health.systems` don't throw.
  const emptyNamespace: ScopeHealthNamespace = { systems: {} };
  if (ids.length === 0 || !client) {
    scope.health = emptyNamespace;
    return scope;
  }

  let resolveIds = ids;
  if (ids.length > MAX_RESOLVED_SYSTEMS) {
    logger.warn(
      `enrichScopeWithState: resolving only the first ${MAX_RESOLVED_SYSTEMS} of ${ids.length} requested systems (cap reached)`,
    );
    resolveIds = ids.slice(0, MAX_RESOLVED_SYSTEMS);
  }

  try {
    const { states } = await client.getBulkHealthState({
      systemIds: resolveIds,
    });
    const systems: Record<string, ScopeHealthState> = {};
    for (const [id, state] of Object.entries(states)) {
      systems[id] = toScopeState(state);
    }
    const namespace: ScopeHealthNamespace = {
      systems,
      system: contextKey ? systems[contextKey] : undefined,
    };
    scope.health = namespace;
    return scope;
  } catch (error) {
    logger.warn(
      `enrichScopeWithState: failed to resolve health state; falling back to empty namespace: ${
        (error as Error).message
      }`,
    );
    scope.health = emptyNamespace;
    return scope;
  }
}
