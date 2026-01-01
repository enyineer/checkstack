import { createSlot } from "@checkmate/frontend-api";
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
 * import { SystemDetailsSlot } from "@checkmate/catalog-common";
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
 * import { CatalogSystemActionsSlot } from "@checkmate/catalog-common";
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
