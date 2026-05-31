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
  /** Status changes in the trailing window (generalized flapping). */
  transitions_in_window: number;
  /** The window (minutes) `transitions_in_window` was counted over. */
  transition_window_minutes: number;
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
  transitionsInWindow: number;
  transitionWindowMinutes: number;
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
    transitions_in_window: state.transitionsInWindow,
    transition_window_minutes: state.transitionWindowMinutes,
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
  /**
   * Trailing window (minutes) for the folded `transitions_in_window`
   * count (the automation's `state_window_minutes`). Provider default
   * (60) applies when omitted.
   */
  transitionWindowMinutes?: number;
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
  const { scope, client, logger, contextKey, usesState, transitionWindowMinutes } =
    args;

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
      transitionWindowMinutes,
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

// ─── Generic entity scope enrichment (reactive automation engine §3.6) ──────
//
// Two complementary projections of live state coexist by design, not as a
// migration shim:
//
//   - `scope.health.*` (rich condition snapshot) — populated by
//     `enrichScopeWithState` above. It carries the FULL health aggregate
//     (status, latency_ms, p95_latency_ms, success_rate, in_status_since,
//     in_status_for_ms, in_maintenance, transitions_in_window, …) that the
//     structured `state` / `numeric_state` condition evaluators read. The
//     health aggregate is not stored as a framework entity row, so it is
//     resolved through the healthcheck RPC, not the entity store.
//
//   - `scope.state.<kind>.<id>.<field>` (minimal reactive entity view) —
//     populated here. It carries the small reactive subset each kind's
//     `defineEntity` exposes through its plugin `read` accessor (e.g. an
//     incident's `{ status, severity }`, or health's
//     `{ status, healthyChecks, totalChecks }`). This is what the reactive
//     `wait_until` wake re-eval resolves so a wait on any entity kind sees
//     current state after a change.
//
// The wait re-eval (`reEnrichWaitScope`) deliberately resolves health via
// the RICH RPC path and EXCLUDES the `health` kind from the refs it passes
// here, so health is resolved at most once per scope build and conditions
// always read the rich snapshot. The `health` branch in
// `projectHealthAlias` therefore only ever runs for a direct caller that
// passes a `health` ref (none in the dispatch engine today); it is kept as
// a defensive projection, gated so it never clobbers a richer
// `scope.health` already set by `enrichScopeWithState`.

/** A `{kind, id}` entity reference to pre-resolve into scope. */
export interface EntityRef {
  kind: string;
  id: string;
}

/**
 * Batched, per-kind resolver — `getMany(ids)` for a single kind, mirroring
 * `getBulkHealthState`. Missing ids are simply absent from the result.
 */
export type EntityKindResolver = (
  ids: ReadonlyArray<string>,
) => Promise<Record<string, Record<string, unknown>>>;

export interface EnrichScopeWithEntitiesArgs {
  /** The mutable scope to fold `state.<kind>.<id>` into. Returned for convenience. */
  scope: Record<string, unknown>;
  logger: Logger;
  /** The refs to resolve (deduped + bounded internally). */
  refs: ReadonlyArray<EntityRef>;
  /** Resolve a `getMany` resolver for a kind, or undefined if unknown. */
  resolverFor: (kind: string) => EntityKindResolver | undefined;
}

/** Read the `state` namespace off scope, creating it if absent. */
function stateNamespace(
  scope: Record<string, unknown>,
): Record<string, Record<string, Record<string, unknown>>> {
  const existing = scope.state;
  if (
    typeof existing === "object" &&
    existing !== null &&
    !Array.isArray(existing)
  ) {
    return existing as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
  }
  const fresh: Record<string, Record<string, Record<string, unknown>>> = {};
  scope.state = fresh;
  return fresh;
}

/**
 * Resolve the given entity refs through their per-kind resolvers and fold
 * them into `scope.state.<kind>.<id>`. Refs are de-duplicated per kind and
 * the total resolved set is bounded by {@link MAX_RESOLVED_SYSTEMS} (the
 * runtime backstop). A kind with no resolver, or a resolver error, is
 * fail-open: the kind is left absent and a warn is logged — one kind's
 * outage never wedges unrelated automations.
 *
 * If a `health` kind was resolved here (no dispatch path does this today —
 * the wait re-eval resolves health via the rich RPC path instead),
 * {@link projectHealthAlias} projects it into the `scope.health` shape the
 * condition evaluators read, but only when no richer `scope.health` is
 * already present.
 */
export async function enrichScopeWithEntities(
  args: EnrichScopeWithEntitiesArgs,
): Promise<Record<string, unknown>> {
  const { scope, logger, refs, resolverFor } = args;
  const state = stateNamespace(scope);

  // Group de-duplicated ids per kind, bounded overall.
  const byKind = new Map<string, string[]>();
  const seen = new Set<string>();
  let total = 0;
  let capped = false;
  for (const { kind, id } of refs) {
    if (kind.length === 0 || id.length === 0) continue;
    const key = `${kind}:${id}`;
    if (seen.has(key)) continue;
    if (total >= MAX_RESOLVED_SYSTEMS) {
      capped = true;
      break;
    }
    seen.add(key);
    total += 1;
    const ids = byKind.get(kind);
    if (ids) ids.push(id);
    else byKind.set(kind, [id]);
  }
  if (capped) {
    logger.warn(
      `enrichScopeWithEntities: resolving only the first ${MAX_RESOLVED_SYSTEMS} refs (cap reached)`,
    );
  }

  for (const [kind, ids] of byKind) {
    const resolver = resolverFor(kind);
    if (!resolver) {
      logger.warn(
        `enrichScopeWithEntities: no resolver for kind "${kind}"; leaving it unresolved`,
      );
      continue;
    }
    try {
      const resolved = await resolver(ids);
      const kindBucket = state[kind] ?? {};
      for (const [id, entityState] of Object.entries(resolved)) {
        kindBucket[id] = entityState;
      }
      state[kind] = kindBucket;
    } catch (error) {
      logger.warn(
        `enrichScopeWithEntities: failed to resolve kind "${kind}": ${
          (error as Error).message
        }`,
      );
    }
  }

  // If a `health` kind was resolved into `state` (not done by the dispatch
  // engine, which resolves health via the rich RPC path), project it into
  // the `scope.health` shape the condition evaluators read — but never over
  // a richer `scope.health` already set by `enrichScopeWithState`.
  projectHealthAlias(scope, state);
  return scope;
}

/**
 * Project the resolved minimal `state.health.<id>` entities into the
 * `scope.health` shape (`{ systems: { <id>: ... } }`) the condition
 * evaluators read. Runs ONLY when a `health` kind was resolved into `state`
 * AND no `scope.health` is already present: the rich `enrichScopeWithState`
 * snapshot (status + latency + p95 + success_rate + transitions, …) is
 * strictly a superset of this minimal entity view, so an existing
 * `scope.health` must never be clobbered with the thinner projection. No
 * dispatch path resolves a `health` ref through `enrichScopeWithEntities`
 * today (the wait re-eval excludes the kind), so this is a defensive
 * projection for any direct caller, not a per-dispatch second resolution.
 */
function projectHealthAlias(
  scope: Record<string, unknown>,
  state: Record<string, Record<string, Record<string, unknown>>>,
): void {
  const healthEntities = state.health;
  if (!healthEntities) return;
  // A richer rich-snapshot `scope.health` already won — leave it untouched.
  if (scope.health !== undefined) return;
  const systems: Record<string, Record<string, unknown>> = {};
  for (const [id, value] of Object.entries(healthEntities)) {
    systems[id] = value;
  }
  scope.health = { systems };
}
