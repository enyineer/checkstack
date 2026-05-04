/**
 * A type-safe slot definition that can be exported from plugin common packages.
 *
 * @typeParam TContext  - Props passed to every extension component at render time.
 * @typeParam TMetadata - Static descriptor each extension declares at registration time
 *                        (e.g. label, icon, ordering, access rules). Use `undefined`
 *                        (the default) when the slot just renders components without
 *                        per-extension metadata.
 */
export interface SlotDefinition<TContext = undefined, TMetadata = undefined> {
  /** Unique slot identifier, recommended format: "plugin-name.area.purpose" */
  readonly id: string;
  /** Phantom type for context type inference - do not use directly */
  readonly _contextType?: TContext;
  /** Phantom type for metadata type inference - do not use directly */
  readonly _metadataType?: TMetadata;
}

/**
 * Creates a type-safe slot definition that can be exported from any package.
 *
 * @example
 * // Render-only slot (no metadata)
 * export const SystemDetailsSlot = createSlot<{ systemId: string }>(
 *   "catalog.system.details"
 * );
 *
 * @example
 * // Slot whose extensions declare metadata at registration time
 * interface InfrastructureTabMetadata {
 *   label: string;
 *   icon: React.ComponentType<{ className?: string }>;
 *   readAccess: AccessRule;
 *   manageAccess: AccessRule;
 *   order?: number;
 * }
 * export const InfrastructureTabsSlot = createSlot<
 *   { canUpdate: boolean },
 *   InfrastructureTabMetadata
 * >("infrastructure.tabs");
 */
export function createSlot<TContext = undefined, TMetadata = undefined>(
  id: string
): SlotDefinition<TContext, TMetadata> {
  return { id } as SlotDefinition<TContext, TMetadata>;
}

/**
 * Core layout slots - no context required
 */
export const DashboardSlot = createSlot("dashboard");
export const NavbarLeftSlot = createSlot("core.layout.navbar.left");
export const NavbarCenterSlot = createSlot("core.layout.navbar.center");
export const NavbarRightSlot = createSlot("core.layout.navbar.right");

/**
 * Context for user menu item slots.
 * Provides the user's access rules array and authentication info for synchronous checks.
 */
export interface UserMenuItemsContext {
  accessRules: string[];
  hasCredentialAccount: boolean;
}

export const UserMenuItemsSlot = createSlot<UserMenuItemsContext>(
  "core.layout.navbar.user-menu.items"
);
export const UserMenuItemsBottomSlot = createSlot<UserMenuItemsContext>(
  "core.layout.navbar.user-menu.items.bottom"
);
