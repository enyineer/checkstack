/**
 * Incident cross-plugin hooks.
 *
 * The `incident.created` / `.updated` / `.resolved` hooks were removed in
 * Phase 4 (§10.1): incidents are now the reactive `incident` entity, whose
 * change deriver fires the matching `incident.created` / `.updated` /
 * `.resolved` trigger events through Stage-1 routing. No cross-plugin hook
 * remains, so this object is intentionally empty (kept for the stable
 * `export { incidentHooks }` surface).
 */
export const incidentHooks = {} as const;
