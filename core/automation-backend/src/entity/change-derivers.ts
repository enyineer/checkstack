/**
 * Entity-change → trigger-event derivation registry (reactive automation
 * engine §7, Stage-1 routing).
 *
 * Stage 1 turns an `ENTITY_CHANGED` into the set of qualified trigger event
 * ids to route to fresh runs (via `findEnabledByTriggerEvent`). The mapping
 * from "this kind changed like THIS" to "these trigger events fired" is
 * DOMAIN knowledge — incident's `incident.created`/`.resolved`, health's
 * `system.degraded`, etc. — so it can't live in the kind-agnostic engine.
 *
 * This is the generic registry the engine owns: domains register a per-kind
 * deriver in Phase 4 (their migration). In Phase 5 no real domains are
 * migrated, so this routes nothing in production yet — that is expected and
 * correct. The engine calls every deriver registered for the changed kind
 * and unions their results.
 *
 * A deriver receives the validated `EntityChanged` payload and returns the
 * trigger event id(s) the change should fire (e.g. `["healthcheck.system.degraded"]`).
 * It returns an empty array when the change fires nothing.
 */
import type { EntityChanged } from "@checkstack/automation-common";

/**
 * Derive the qualified trigger event id(s) a change of one entity kind
 * should route to. Pure + synchronous. Returns `[]` for "no trigger event".
 */
export type EntityChangeDeriver = (
  changed: EntityChanged,
) => ReadonlyArray<string>;

/**
 * Map an entity change to the DOMAIN-named trigger payload (`trigger.payload`)
 * a fresh run sees. Pure + synchronous.
 *
 * The generic `EntityChanged` shape (`{ kind, id, prev, next, delta, ... }`)
 * is editor/engine-internal; operators author filters and templates against
 * the domain-named `payloadSchema` a trigger declares (incident `incidentId`,
 * health `systemId` / `previousStatus`, …). Without a mapper the runtime
 * payload would NOT carry those documented keys and `trigger.payload.incidentId`
 * etc. would silently resolve to `undefined` (a regression vs the legacy hook
 * payloads). A domain registers `toPayload` alongside its deriver so the
 * runtime payload matches its declared `payloadSchema`. Stage-2 falls back to
 * the generic shape for kinds without a mapper.
 */
export type EntityChangePayloadMapper = (
  changed: EntityChanged,
) => Record<string, unknown>;

export interface ChangeDeriverRegistry {
  /**
   * Register a deriver (and optional payload mapper) for an entity `kind`.
   * Multiple derivers may be registered per kind (their outputs union);
   * registering the same deriver twice is harmless.
   *
   * `toPayload`, when supplied, maps a change of this kind to the domain-named
   * `trigger.payload` shape the kind's `payloadSchema` declares (see
   * {@link EntityChangePayloadMapper}). At most one payload mapper may be
   * registered per kind — a second distinct mapper throws (the payload shape
   * for a kind must be unambiguous).
   */
  register(args: {
    kind: string;
    derive: EntityChangeDeriver;
    toPayload?: EntityChangePayloadMapper;
  }): void;

  /**
   * Derive the union of qualified trigger event ids for a change, across
   * every deriver registered for `changed.kind`. De-duplicated, stable
   * order (registration order, first-seen wins).
   */
  derive(changed: EntityChanged): ReadonlyArray<string>;

  /**
   * Map a change to its domain-named `trigger.payload`, using the payload
   * mapper registered for `changed.kind`. Returns `undefined` when the kind
   * has no registered mapper (the caller falls back to the generic payload
   * shape).
   */
  payload(changed: EntityChanged): Record<string, unknown> | undefined;

  /** Kinds that have at least one registered deriver. */
  kinds(): ReadonlyArray<string>;
}

export function createChangeDeriverRegistry(): ChangeDeriverRegistry {
  const byKind = new Map<string, EntityChangeDeriver[]>();
  const payloadByKind = new Map<string, EntityChangePayloadMapper>();

  return {
    register({ kind, derive, toPayload }) {
      if (typeof kind !== "string" || kind.trim().length === 0) {
        throw new Error("registerChangeDeriver: `kind` must be a non-empty string");
      }
      const list = byKind.get(kind);
      if (list) {
        if (!list.includes(derive)) list.push(derive);
      } else {
        byKind.set(kind, [derive]);
      }
      if (toPayload) {
        const existing = payloadByKind.get(kind);
        if (existing && existing !== toPayload) {
          throw new Error(
            `registerChangeDeriver: a payload mapper is already registered for kind "${kind}"`,
          );
        }
        payloadByKind.set(kind, toPayload);
      }
    },

    derive(changed) {
      const derivers = byKind.get(changed.kind);
      if (!derivers || derivers.length === 0) return [];
      const seen = new Set<string>();
      const out: string[] = [];
      for (const derive of derivers) {
        let ids: ReadonlyArray<string>;
        try {
          ids = derive(changed);
        } catch {
          // A misbehaving deriver must not wedge routing for the others.
          continue;
        }
        for (const id of ids) {
          if (typeof id !== "string" || id.length === 0 || seen.has(id)) continue;
          seen.add(id);
          out.push(id);
        }
      }
      return out;
    },

    payload(changed) {
      const mapper = payloadByKind.get(changed.kind);
      return mapper ? mapper(changed) : undefined;
    },

    kinds() {
      return [...byKind.keys()];
    },
  };
}
