import type React from "react";
import type { AccessRule } from "@checkstack/common";

/**
 * Tab registration for the Infrastructure Configuration page.
 *
 * Each infrastructure concern (Queue, Cache, etc.) registers a tab
 * with its own access rules, icon, and component.
 *
 * The shell page evaluates user access per tab and only shows
 * tabs the user can read. If no tabs are visible, it shows "not authorized".
 */
export interface InfrastructureTab {
  /** Unique tab ID (e.g., "queue", "cache") */
  id: string;

  /** Plugin ID that registers this tab (e.g., "queue", "cache") */
  pluginId: string;

  /** Tab display label */
  label: string;

  /** Tab icon component */
  icon: React.ComponentType<{ className?: string }>;

  /** The tab content component */
  component: React.ComponentType<{ canUpdate: boolean }>;

  /** Access rule required to view this tab */
  readAccess: AccessRule;

  /** Access rule required to modify settings in this tab */
  manageAccess: AccessRule;

  /** Sort order — lower numbers appear first */
  order?: number;
}

/**
 * Global tab registry for Infrastructure Configuration.
 *
 * Plugins register their tabs here during frontend plugin initialization.
 * The infrastructure page reads from this registry to build its tab bar.
 *
 * This is a simple module-level registry — no React context needed
 * since tabs are registered at module load time (during eager plugin loading).
 */
const tabs: InfrastructureTab[] = [];

export function registerInfrastructureTab(tab: InfrastructureTab): void {
  // Prevent duplicate registration
  if (tabs.some((t) => t.id === tab.id)) {
    return;
  }
  tabs.push(tab);
  // Keep sorted by order
  tabs.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

export function getInfrastructureTabs(): readonly InfrastructureTab[] {
  return tabs;
}
