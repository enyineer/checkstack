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

export interface ChangeDeriverRegistry {
  /**
   * Register a deriver for an entity `kind`. Multiple derivers may be
   * registered per kind (their outputs union); registering the same deriver
   * twice is harmless.
   */
  register(args: { kind: string; derive: EntityChangeDeriver }): void;

  /**
   * Derive the union of qualified trigger event ids for a change, across
   * every deriver registered for `changed.kind`. De-duplicated, stable
   * order (registration order, first-seen wins).
   */
  derive(changed: EntityChanged): ReadonlyArray<string>;

  /** Kinds that have at least one registered deriver. */
  kinds(): ReadonlyArray<string>;
}

export function createChangeDeriverRegistry(): ChangeDeriverRegistry {
  const byKind = new Map<string, EntityChangeDeriver[]>();

  return {
    register({ kind, derive }) {
      if (typeof kind !== "string" || kind.trim().length === 0) {
        throw new Error("registerChangeDeriver: `kind` must be a non-empty string");
      }
      const list = byKind.get(kind);
      if (list) {
        if (!list.includes(derive)) list.push(derive);
      } else {
        byKind.set(kind, [derive]);
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

    kinds() {
      return [...byKind.keys()];
    },
  };
}
