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
import { ScriptPackagesSettingsPage } from "./pages/ScriptPackagesSettingsPage";
import { ScriptPackagesMenuItems } from "./components/ScriptPackagesMenuItems";

/**
 * Frontend plugin for script-package management.
 *
 * Route: `/script-packages/` -> the admin settings page (allowlist,
 * registry/storage summary, install state + size, satellite sync). Gated
 * on `script-packages.manage`.
 *
 * The `useScriptPackageTypes()` hook (exported below) lets editor pages
 * fetch installed-package `.d.ts` and merge it into the `typeDefinitions`
 * that flows through `DynamicForm`, giving package IntelliSense in every
 * script field.
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
      metadata: { group: "Administration" },
    }),
  ],
});

export { useScriptPackageTypes } from "./useScriptPackageTypes";
