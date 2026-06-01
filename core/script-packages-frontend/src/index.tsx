import {
  createFrontendPlugin,
  createSlotExtension,
  UserMenuItemsSlot,
} from "@checkstack/frontend-api";
import {
  scriptPackagesRoutes,
  scriptPackagesAccess,
  pluginMetadata,
} from "@checkstack/script-packages-common";
import { lazy } from "react";
import { ScriptPackagesMenuItems } from "./components/ScriptPackagesMenuItems";

// Lazy-loaded so the page body is a per-route chunk, not in the initial load.
const ScriptPackagesSettingsPage = lazy(() =>
  import("./pages/ScriptPackagesSettingsPage").then((m) => ({
    default: m.ScriptPackagesSettingsPage,
  })),
);

/**
 * Frontend plugin for script-package management.
 *
 * Route: `/script-packages/` -> the admin settings page (allowlist,
 * registry/storage summary, install state + size, satellite sync). Gated
 * on `script-packages.manage`.
 *
 * The `useScriptPackageTypeAcquisition()` hook (exported below) gives editor
 * pages a lazy ATA resolver + install reset-key to pass to `DynamicForm`'s
 * `acquireTypes` / `acquireResetKey`, so a script editor fetches + registers
 * the `.d.ts` of any npm package it imports (incl. `@types/*`) on demand.
 */
export default createFrontendPlugin({
  metadata: pluginMetadata,
  routes: [
    {
      route: scriptPackagesRoutes.routes.settings,
      element: <ScriptPackagesSettingsPage />,
      title: "Script packages",
      accessRule: scriptPackagesAccess.manage,
    },
  ],
  extensions: [
    createSlotExtension(UserMenuItemsSlot, {
      id: "script-packages.user-menu.items",
      component: ScriptPackagesMenuItems,
      metadata: { group: "Configuration" },
    }),
  ],
});

export { useScriptPackageTypeAcquisition } from "./useScriptPackageTypeAcquisition";
