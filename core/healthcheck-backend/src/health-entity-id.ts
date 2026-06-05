/**
 * The `health` reactive entity id-shape (§7.4.1, Phase 3b).
 *
 * The reactive engine keys entities by a single opaque string id. The `health`
 * kind encodes TWO views into that one id space:
 *
 *  - **System rollup** — the BARE `"<systemId>"`. Unchanged from the pre-3b
 *    contract: it is the worst-status rollup across the system's environments
 *    (and env-less runs). Dashboards, badges, and existing system-level
 *    automations reference this id and keep working WITHOUT re-authoring.
 *  - **Per-environment** — `"<systemId>::<environmentId>"` (double-colon
 *    separator). Catalog `text` ids never contain `::`, so the separator is
 *    unambiguous. State shape is identical; only the id distinguishes them.
 *
 * This module is the SINGLE source of truth for encoding / decoding that id so
 * the read accessor, the write helper, the change deriver, the payload mapper,
 * and (read-only) the automation scope enrichment all agree on the shape.
 */

/** The separator between systemId and environmentId in a per-env entity id. */
export const HEALTH_ENTITY_ID_SEPARATOR = "::";

/** A decoded `health` entity id. `environmentId === null` ⇒ the system rollup. */
export interface ParsedHealthEntityId {
  systemId: string;
  /** null for the bare system rollup id; the env id for a per-env id. */
  environmentId: string | null;
}

/**
 * Encode a `health` entity id from its parts. A `null`/`undefined`
 * environmentId yields the bare rollup id `"<systemId>"`; a concrete
 * environmentId yields `"<systemId>::<environmentId>"`.
 */
export function encodeHealthEntityId(args: {
  systemId: string;
  environmentId?: string | null;
}): string {
  const { systemId, environmentId } = args;
  if (environmentId === null || environmentId === undefined) return systemId;
  return `${systemId}${HEALTH_ENTITY_ID_SEPARATOR}${environmentId}`;
}

/**
 * Decode a `health` entity id into `(systemId, environmentId)`. An id with no
 * separator is the system rollup (`environmentId: null`). Splits on the FIRST
 * separator so a (hypothetical) env id containing `::` still resolves a stable
 * systemId; catalog ids don't contain `::`, so this is defensive only.
 */
export function parseHealthEntityId(id: string): ParsedHealthEntityId {
  const idx = id.indexOf(HEALTH_ENTITY_ID_SEPARATOR);
  if (idx === -1) return { systemId: id, environmentId: null };
  return {
    systemId: id.slice(0, idx),
    environmentId: id.slice(idx + HEALTH_ENTITY_ID_SEPARATOR.length),
  };
}
