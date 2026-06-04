import { createSlot } from "@checkstack/frontend-api";
import type { IconName } from "@checkstack/common";
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
export const SystemDetailsSlot = createSlot<{ system: System }>(
  "plugin.catalog.system-details"
);

/**
 * Slot for adding actions to the catalog system configuration page.
 * Extensions receive the system ID and name.
 *
 * @example
 * // In your plugin
 * import { CatalogSystemActionsSlot } from "@checkstack/catalog-common";
 *
 * extensions: [{
 *   id: "my-plugin.system-actions",
 *   slotId: CatalogSystemActionsSlot.id,
 *   component: ({ systemId, systemName }) => <MyAction systemId={systemId} />,
 * }]
 */
export const CatalogSystemActionsSlot = createSlot<{
  systemId: string;
  systemName: string;
}>("plugin.catalog.system-actions");

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
 * Slot for extending the System Editor dialog with additional sections.
 * Only rendered when editing an existing system (not during creation).
 * Extensions receive the system ID.
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

