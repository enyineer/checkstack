import { createFrontendPlugin } from "@checkstack/frontend-api";
import {
  scriptPackagesRoutes,
  scriptPackagesAccess,
  scriptSandboxAccess,
  pluginMetadata,
} from "@checkstack/script-packages-common";
import { Package, ShieldCheck } from "lucide-react";

/**
 * Frontend plugin for script-package management.
 *
 * Routes:
 *  - `/script-packages/` -> the admin settings page (allowlist,
 *    registry/storage summary, install state + size, satellite sync). Gated
 *    on `script-packages.manage`.
 *  - `/script-packages/sandbox` -> the global script-sandbox policy editor,
 *    gated on the dedicated admin `script-sandbox.manage` permission.
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
      load: () =>
        import("./pages/ScriptPackagesSettingsPage").then((m) => ({
          default: m.ScriptPackagesSettingsPage,
        })),
      title: "Script packages",
      accessRule: scriptPackagesAccess.manage,
      nav: {
        group: "Developer",
        icon: Package,
        label: "Script Packages",
      },
    },
    {
      route: scriptPackagesRoutes.routes.sandbox,
      load: () =>
        import("./pages/SandboxSettingsPage").then((m) => ({
          default: m.SandboxSettingsPage,
        })),
      title: "Script sandbox",
      accessRule: scriptSandboxAccess.manage,
      nav: {
        group: "Developer",
        icon: ShieldCheck,
        label: "Script Sandbox",
      },
    },
  ],
});

export { useScriptPackageTypeAcquisition } from "./useScriptPackageTypeAcquisition";
export { useSdkTypeInjection } from "./useSdkTypeInjection";
