/**
 * Catalog cross-plugin hooks.
 *
 * The `catalog.system.created` / `.updated` / `.deleted` +
 * `catalog.group.created` / `.deleted` hooks were removed in Phase 4
 * (§10.4): catalog systems + groups are now the reactive `catalog-system`
 * / `catalog-group` entities, whose change derivers fire the matching
 * `catalog.created` / `.updated` / `.deleted` trigger events through
 * Stage-1 routing, and cross-plugin cleanup reactors subscribe to the
 * `catalog-system` tombstone via `onEntityChanged`. No cross-plugin hook
 * remains, so this object is intentionally empty (kept for the stable
 * `export { catalogHooks }` surface).
 */
export const catalogHooks = {} as const;
