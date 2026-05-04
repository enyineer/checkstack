import type React from "react";
import type { AccessRule } from "@checkstack/common";
import { createSlot } from "@checkstack/frontend-api";

/**
 * Render-time props for an Infrastructure tab body component.
 *
 * The shell page resolves the user's manage-access permission for the tab
 * (declared in the extension's metadata) and passes it down so the tab body
 * can disable update affordances accordingly.
 */
export interface InfrastructureTabContext {
  canUpdate: boolean;
}

/**
 * Static descriptor each tab declares at extension-registration time.
 *
 * The shell page reads these to render the vertical tab bar (label + icon),
 * to determine which tabs the current user can see (`readAccess`) and to
 * order tabs (`order`). Whether the tab body is interactive is decided by
 * `manageAccess`, evaluated by the page and forwarded as `canUpdate`.
 */
export interface InfrastructureTabMetadata {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  readAccess: AccessRule;
  manageAccess: AccessRule;
  order?: number;
}

/**
 * Slot for the Infrastructure Settings page tab bar.
 *
 * Plugins that own an infrastructure concern (queue, cache, …) register an
 * extension into this slot via `createSlotExtension` from
 * `@checkstack/frontend-api`. The shell page in `@checkstack/infrastructure-frontend`
 * is the only consumer.
 *
 * Dependency direction: `queue-frontend` → `infrastructure-common` (the slot
 * owner). `infrastructure-frontend` does NOT depend on the contributing
 * plugins.
 */
export const InfrastructureTabsSlot = createSlot<
  InfrastructureTabContext,
  InfrastructureTabMetadata
>("infrastructure.tabs");
