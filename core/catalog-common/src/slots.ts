import { createSlot } from "@checkstack/frontend-api";
import type { IconName, AccessRule } from "@checkstack/common";
import type { System } from "./types";

/**
 * Slot for extending the top of the System Details page.
 * Use for important alerts like active maintenances that should be shown prominently.
 * Extensions receive the full system object.
 *
 * @example
 * extensions: [{
 *   id: "my-plugin.system-details-top",
 *   slotId: SystemDetailsTopSlot.id,
 *   component: ({ system }) => <MaintenanceAlert system={system} />,
 * }]
 */
export const SystemDetailsTopSlot = createSlot<{ system: System }>(
  "plugin.catalog.system-details-top"
);

/**
 * Slot for extending the System Details page with additional content.
 * Extensions receive the full system object.
 *
 * @example
 * // In your plugin
 * import { SystemDetailsSlot } from "@checkstack/catalog-common";
 *
 * extensions: [{
 *   id: "my-plugin.system-details",
 *   slotId: SystemDetailsSlot.id,
 *   component: ({ system }) => <MyComponent system={system} />,
 * }]
 */
export const SystemDetailsSlot = createSlot<{
  system: System;
  /**
   * Optional: the card reports whether its own data is still loading, tagged
   * with a stable `sourceId`. The system detail page holds the overview column
   * on a skeleton set until every card has settled, then reveals them together,
   * so the cards do not pop in one after another. Cards that self-hide when
   * empty simply never appear on reveal; a card that never reports is bounded by
   * a grace period. A card with no async data can ignore this (it is treated as
   * settled once the column's other cards are).
   */
  onLoadingChange?: (sourceId: string, loading: boolean) => void;
}>("plugin.catalog.system-details");

/**
 * Slot for adding actions to the catalog system configuration page.
 * Extensions receive the system ID and name.
 *
 * `visibleSystemIds` is every system id currently rendered in the list this row
 * belongs to (just `[systemId]` on a single-system surface). A filler that shows
 * per-system data (e.g. an assigned-health-check count) can bulk-fetch for the
 * whole visible set in ONE request keyed on that array, instead of one request
 * per row: every row receives the same ids, so identical-input queries dedupe.
 * This mirrors how {@link CatalogBrowseHealthSlot} and {@link SystemSignalsSlot}
 * pass `systemIds` for bulk-fetching.
 *
 * @example
 * // In your plugin
 * import { CatalogSystemActionsSlot } from "@checkstack/catalog-common";
 *
 * extensions: [{
 *   id: "my-plugin.system-actions",
 *   slotId: CatalogSystemActionsSlot.id,
 *   component: ({ systemId, visibleSystemIds }) => (
 *     <MyAction systemId={systemId} visibleSystemIds={visibleSystemIds} />
 *   ),
 * }]
 */
export const CatalogSystemActionsSlot = createSlot<{
  systemId: string;
  systemName: string;
  /**
   * Every system id currently visible in this row's list. Lets a filler
   * bulk-fetch per-system data for the whole visible set in one deduped request
   * rather than an N+1 fan-out. On a single-system surface this is `[systemId]`.
   */
  visibleSystemIds: string[];
}>("plugin.catalog.system-actions");

/**
 * Slot for adding BULK actions to the catalog systems management list, rendered
 * in the multi-select action bar. Extensions receive the currently-selected
 * systems and an `onDone` callback to clear the selection after a successful
 * bulk operation. Mirrors {@link CatalogSystemActionsSlot} but for many systems
 * at once (e.g. "Scope selected systems to a team"). Catalog gains no
 * dependency on the filler.
 *
 * @example
 * extensions: [{
 *   id: "my-plugin.system-bulk-actions",
 *   slotId: CatalogSystemBulkActionsSlot.id,
 *   component: ({ systems, onDone }) => (
 *     <MyBulkAction systems={systems} onDone={onDone} />
 *   ),
 * }]
 */
export const CatalogSystemBulkActionsSlot = createSlot<{
  systems: Array<{ id: string; name: string }>;
  onDone: () => void;
}>("plugin.catalog.system-bulk-actions");

/**
 * Slot for displaying system state badges.
 * Plugins use this to contribute state indicators (e.g., health status, maintenance status).
 * Extensions receive the system and should render badge components.
 *
 * @example
 * // In your plugin
 * import { SystemStateBadgesSlot } from "@checkstack/catalog-common";
 *
 * extensions: [{
 *   id: "my-plugin.system-state-badge",
 *   slotId: SystemStateBadgesSlot.id,
 *   component: ({ system }) => <MyStatusBadge systemId={system.id} />,
 * }]
 */
export const SystemStateBadgesSlot = createSlot<{ system: System }>(
  "plugin.catalog.system-state-badges"
);

/**
 * Slot for read-only metadata sections in the System Details right sidebar
 * (alongside About / Contacts / Links / Groups). Use for quiet, contextual
 * facts about the system — e.g. auth-frontend contributes a "who can change
 * this" access indicator. Extensions receive the full system.
 *
 * @example
 * extensions: [{
 *   id: "my-plugin.system-meta",
 *   slotId: SystemMetaSlot.id,
 *   component: ({ system }) => <MyMetaSection system={system} />,
 * }]
 */
export const SystemMetaSlot = createSlot<{ system: System }>(
  "plugin.catalog.system-meta"
);

/**
 * Catalog-owned health status vocabulary for the browse-view rollup. These are
 * the only values a slot filler may report through {@link CatalogBrowseHealthSlot}.
 *
 * This is deliberately catalog's OWN enum, not an import of healthcheck's
 * status enum: the catalog browse view must not depend on healthcheck. A filler
 * (e.g. healthcheck-frontend) maps its own status into these values. `"unknown"`
 * is never reported by a filler — it is the catalog-side default for a system
 * the filler did not report a status for (no health source, or no checks wired).
 */
export type CatalogHealthStatus = "healthy" | "degraded" | "unhealthy";

/**
 * The shape a {@link CatalogBrowseHealthSlot} filler reports back to the catalog
 * browse view: a per-system-id status map. Systems absent from the map are
 * treated as `"unknown"` by the rollup (NEVER as healthy).
 */
export type CatalogHealthStatuses = Record<string, CatalogHealthStatus>;

/**
 * Context passed to a {@link CatalogBrowseHealthSlot} filler.
 *
 * - `systemIds` — every system id currently visible in the browse view, so the
 *   filler can bulk-fetch their statuses in one request.
 * - `onStatuses` — the filler reports the resolved statuses here. The catalog
 *   browse view derives its group-level rollup (worst-of) and powers the health
 *   filter from this DATA, NOT from any rendered badge: healthy systems emit no
 *   badge, so "all healthy" can only be derived from the reported map.
 *
 * The filler renders nothing visible — it is a headless data boundary. Per-system
 * badges continue to come from {@link SystemStateBadgesSlot}.
 */
export interface CatalogBrowseHealthSlotContext {
  systemIds: string[];
  onStatuses: (statuses: CatalogHealthStatuses) => void;
  /**
   * Optional: the filler reports whether its bulk health fetch is still loading.
   * A consumer can use this to show a per-row loading placeholder in a health
   * column until the statuses arrive, instead of the badges popping in onto an
   * empty cell. Omitted-safe: consumers that only need the resolved statuses can
   * ignore it, and a filler that does not report it just never signals loading.
   */
  onLoading?: (loading: boolean) => void;
}

/**
 * Optional platform contract for surfacing bulk system-health data inline on the
 * catalog browse view WITHOUT coupling catalog to any health provider.
 *
 * - catalog-frontend only CONSUMES this slot: it renders the slot once (a headless
 *   data boundary) and feeds the reported statuses into its group rollups + health
 *   filter. When the slot is unfilled, group headers show counts only and the
 *   health filter is disabled — catalog stays fully functional with no health
 *   source installed.
 * - A plugin FILLS this slot to supply statuses (e.g. healthcheck-frontend wraps
 *   dashboard-frontend's existing SystemBadgeDataProvider and reports the
 *   bulk-fetched health via `onStatuses`). All cross-plugin coupling lives on the
 *   filler side; catalog gains no new dependency.
 *
 * @example
 * // In a health provider plugin
 * import { CatalogBrowseHealthSlot } from "@checkstack/catalog-common";
 *
 * extensions: [{
 *   id: "my-plugin.catalog-browse-health",
 *   slotId: CatalogBrowseHealthSlot.id,
 *   component: ({ systemIds, onStatuses }) => (
 *     <MyBulkHealthReporter systemIds={systemIds} onStatuses={onStatuses} />
 *   ),
 * }]
 */
export const CatalogBrowseHealthSlot =
  createSlot<CatalogBrowseHealthSlotContext>(
    "plugin.catalog.browse-health"
  );

/**
 * Severity tone of a dashboard {@link SystemSignal}. Drives the signal's colour,
 * its sort order in the overview (error before warn before info), and the
 * severity counts shown in the overview header.
 */
export type SystemSignalTone = "error" | "warn" | "info";

/**
 * One piece of "needs attention" state a plugin reports about a system for the
 * dashboard overview. A single source may emit several signals for one system
 * (e.g. two open incidents). The dashboard aggregates signals across ALL
 * plugins to decide which systems to surface, how to sort them (worst tone
 * first), what to count in the header, and renders each one as a deep-linking
 * row pointing at the page the issue originates from.
 */
export interface SystemSignal {
  /**
   * Stable id of the contributing source, e.g. "incident" / "slo" /
   * "healthcheck". Used to de-duplicate a source's contribution when it
   * re-reports (see {@link SystemSignalsSlotContext.onSignals}).
   */
  source: string;
  /** Severity tone. */
  tone: SystemSignalTone;
  /** Short label, e.g. "Critical incident". */
  label: string;
  /** Optional longer context, e.g. the incident title or "2 of 3 checks failing". */
  detail?: string;
  /**
   * Deep link (resolved route path) to where the issue originates. Omit when
   * there is no more specific page than the system itself.
   */
  href?: string;
  /**
   * Access rule required to view {@link href}'s target page. When set, the
   * dashboard renders the signal as a LINK only if the user satisfies this rule,
   * and as plain text otherwise - so a user is never offered a link that would
   * immediately hit "Access Denied". Omit only when the target needs no specific
   * permission (the link is then always rendered).
   */
  accessRule?: AccessRule;
  /** ISO timestamp the signal started — shown as a "since" hint and used as a sort tie-break. */
  since?: string;
  /** Lucide icon name (PascalCase), rendered by `@checkstack/ui`'s `DynamicIcon`. */
  iconName?: IconName;
}

/**
 * The per-system-id signal map a {@link SystemSignalsSlot} filler reports for
 * the systems it was handed. Systems absent from the map have no signal from
 * that source (i.e. healthy as far as that source is concerned).
 */
export type SystemSignalsMap = Record<string, SystemSignal[]>;

/**
 * Context passed to a {@link SystemSignalsSlot} filler.
 *
 * - `systemIds` — every system in the overview, so the filler can bulk-fetch
 *   their state in a single request (no N+1).
 * - `onSignals` — the filler reports its resolved per-system signals here,
 *   tagged with its own stable `sourceId`. Re-reporting with the same
 *   `sourceId` REPLACES that source's previous contribution (so a source that
 *   reports an empty map clears its signals). The dashboard derives which
 *   systems need attention purely from this DATA — healthy systems are simply
 *   absent from every source's map.
 *
 * The filler renders nothing visible — it is a headless data boundary, exactly
 * like {@link CatalogBrowseHealthSlot}.
 */
export interface SystemSignalsSlotContext {
  systemIds: string[];
  onSignals: (sourceId: string, signals: SystemSignalsMap) => void;
  /**
   * The filler reports whether its bulk data is still loading, tagged with the
   * SAME stable `sourceId` it uses for {@link onSignals}. The dashboard shows a
   * loading placeholder for the overview until every mounted source has settled
   * at least once - otherwise an empty problem list briefly reads as "all
   * systems healthy" before any source has actually loaded. Report `true` while
   * the query is pending and `false` once it settles (background refetches
   * should NOT re-report `true` on their own - drive this from the initial-load
   * flag, e.g. TanStack's `isLoading`). A source that never reports is treated
   * as still loading; the dashboard bounds the wait so a non-reporting third-
   * party filler cannot hang the overview forever.
   */
  onLoadingChange: (sourceId: string, loading: boolean) => void;
}

/**
 * Extensible platform contract for the dashboard "needs attention" overview.
 * Any plugin FILLS this slot to contribute per-system state signals; the
 * dashboard CONSUMES it (rendering the slot once, headless) and aggregates
 * every source's signals to surface, sort, count, and deep-link problem
 * systems. A new plugin adds a whole new kind of state to the overview just by
 * filling this slot — no dashboard change required.
 *
 * @example
 * // In your plugin
 * import { SystemSignalsSlot } from "@checkstack/catalog-common";
 *
 * extensions: [{
 *   id: "my-plugin.system-signals",
 *   slotId: SystemSignalsSlot.id,
 *   component: ({ systemIds, onSignals }) => (
 *     <MyBulkSignalReporter systemIds={systemIds} onSignals={onSignals} />
 *   ),
 * }]
 */
export const SystemSignalsSlot = createSlot<SystemSignalsSlotContext>(
  "plugin.catalog.system-signals"
);

/**
 * Slot for extending a system's editable surface with additional sections
 * (e.g. the dependency editor). Mounts on the system detail page's manage
 * area, only for callers who can manage the system. Extensions receive the
 * system ID.
 *
 * @example
 * // In your plugin
 * import { SystemEditorSlot } from "@checkstack/catalog-common";
 *
 * extensions: [{
 *   id: "my-plugin.system-editor",
 *   slotId: SystemEditorSlot.id,
 *   component: ({ systemId }) => <MySection systemId={systemId} />,
 * }]
 */
export const SystemEditorSlot = createSlot<{ systemId: string }>(
  "plugin.catalog.system-editor"
);

/**
 * Context passed to a {@link CatalogBrowseDataBoundarySlot} filler.
 *
 * - `systemIds` — every system id currently rendered in the browse view.
 * - `groupIds` — every real group id currently rendered (excluding the
 *   ungrouped pseudo-section), so a filler that also serves group-level surfaces
 *   (e.g. a group's notification bell) can bulk-fetch for groups too.
 *
 * A filler renders its bulk-data PROVIDER around the boundary's `children` (the
 * whole browse tree), so every per-row/per-group component inside can read the
 * bulk data from the provider's context instead of fetching its own. Children
 * are supplied by the catalog-frontend boundary component, not by the filler.
 */
export interface CatalogBrowseDataBoundarySlotContext {
  systemIds: string[];
  groupIds: string[];
}

/**
 * Optional platform contract for eliminating the catalog browse view's per-row
 * N+1 fetches WITHOUT coupling catalog to any data provider.
 *
 * Every system row and group header mounts small contributions (state badges via
 * {@link SystemStateBadgesSlot}, a notification bell, ...) that would each fetch
 * their own data — one request per row. A plugin FILLS this slot with a
 * component that WRAPS the boundary's `children` (the entire browse tree) in a
 * bulk-data PROVIDER keyed on the whole visible `systemIds`/`groupIds` set; the
 * per-row contributions inside then read from that provider's React context and
 * issue no per-row request. catalog-frontend only renders the boundary (folding
 * every registered filler around the tree, so multiple providers nest and the
 * tree renders exactly once); all cross-plugin coupling lives on the filler
 * side, so catalog gains no dependency on any provider plugin. When no filler is
 * installed the boundary renders the tree as-is and each contribution falls back
 * to its own fetch — catalog stays fully functional.
 *
 * The filler component receives {@link CatalogBrowseDataBoundarySlotContext}
 * plus React `children` (typed optional so it stays assignable to the slot
 * context) and MUST render `children` exactly once inside its provider.
 *
 * @example
 * // In a data-provider plugin (e.g. dashboard-frontend)
 * import { CatalogBrowseDataBoundarySlot } from "@checkstack/catalog-common";
 *
 * extensions: [{
 *   id: "my-plugin.catalog-browse-boundary",
 *   slotId: CatalogBrowseDataBoundarySlot.id,
 *   component: ({ systemIds, children }) => (
 *     <MyBulkDataProvider systemIds={systemIds}>{children}</MyBulkDataProvider>
 *   ),
 * }]
 */
export const CatalogBrowseDataBoundarySlot =
  createSlot<CatalogBrowseDataBoundarySlotContext>(
    "plugin.catalog.browse-data-boundary"
  );

