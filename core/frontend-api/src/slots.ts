/**
 * A type-safe slot definition that can be exported from plugin common packages.
 * The context type parameter defines what props extensions will receive.
 */
export interface SlotDefinition<TContext = undefined> {
  /** Unique slot identifier, recommended format: "plugin-name.area.purpose" */
  readonly id: string;
  /** Phantom type for context type inference - do not use directly */
  readonly _contextType?: TContext;
}

/**
 * Creates a type-safe slot definition that can be exported from any package.
 *
 * @example
 * // In @checkmate/catalog-common
 * export const SystemDetailsSlot = createSlot<{ systemId: string }>(
 *   "catalog.system.details"
 * );
 *
 * // In your frontend plugin
 * extensions: [{
 *   id: "my-plugin.system-details",
 *   slot: SystemDetailsSlot,
 *   component: MySystemDetailsExtension, // Receives { systemId: string }
 * }]
 *
 * @param id - Unique slot identifier
 * @returns A slot definition that can be used for type-safe extension registration
 */
export function createSlot<TContext = undefined>(
  id: string
): SlotDefinition<TContext> {
  return { id } as SlotDefinition<TContext>;
}

/**
 * Core layout slots - no context required
 */
export const DashboardSlot = createSlot("dashboard");
export const NavbarSlot = createSlot("core.layout.navbar");
export const NavbarMainSlot = createSlot("core.layout.navbar.main");
export const UserMenuItemsSlot = createSlot(
  "core.layout.navbar.user-menu.items"
);
export const UserMenuItemsBottomSlot = createSlot(
  "core.layout.navbar.user-menu.items.bottom"
);

// Legacy string exports for backward compatibility during migration
/** @deprecated Use DashboardSlot instead */
export const SLOT_DASHBOARD = DashboardSlot.id;
/** @deprecated Use NavbarSlot instead */
export const SLOT_NAVBAR = NavbarSlot.id;
/** @deprecated Use NavbarMainSlot instead */
export const SLOT_NAVBAR_MAIN = NavbarMainSlot.id;
/** @deprecated Use UserMenuItemsSlot instead */
export const SLOT_USER_MENU_ITEMS = UserMenuItemsSlot.id;
/** @deprecated Use UserMenuItemsBottomSlot instead */
export const SLOT_USER_MENU_ITEMS_BOTTOM = UserMenuItemsBottomSlot.id;
