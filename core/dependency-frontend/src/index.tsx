import {
  createFrontendPlugin,
  createSlotExtension,
  UserMenuItemsSlot,
} from "@checkstack/frontend-api";
import {
  pluginMetadata,
  dependencyRoutes,
  dependencyAccess,
} from "@checkstack/dependency-common";
import { SYSTEM_STATUS_CHANGED } from "@checkstack/healthcheck-common";
import {
  SystemDetailsTopSlot,
  SystemStateBadgesSlot,
  SystemEditorSlot,
} from "@checkstack/catalog-common";
import { lazy } from "react";
import { DependencyBadge } from "./components/DependencyBadge";
import { DependencyAlert } from "./components/DependencyAlert";
import { DependencyEditor } from "./components/DependencyEditor";
import { DependencyMenuItems } from "./components/DependencyMenuItems";

// Lazy-loaded so the page body is a per-route chunk, not in the initial load.
const DependencyMapPage = lazy(() =>
  import("./components/DependencyMapPage").then((m) => ({
    default: m.DependencyMapPage,
  })),
);

export default createFrontendPlugin({
  metadata: pluginMetadata,
  // Dependency queries embed system health, so a system status change must
  // also invalidate this plugin's cache. Same-plugin signals (DEPENDENCY_*)
  // are auto-invalidated and must NOT be listed here.
  foreignSignals: [SYSTEM_STATUS_CHANGED],
  routes: [
    {
      route: dependencyRoutes.routes.map,
      element: <DependencyMapPage />,
      title: "Dependency Map",
      accessRule: dependencyAccess.dependency.read,
    },
  ],
  apis: [],
  extensions: [
    createSlotExtension(SystemStateBadgesSlot, {
      id: "dependency.system-state-badge",
      component: DependencyBadge,
    }),
    createSlotExtension(SystemDetailsTopSlot, {
      id: "dependency.system-details-top.alert",
      component: DependencyAlert,
    }),
    createSlotExtension(SystemEditorSlot, {
      id: "dependency.system-editor",
      component: DependencyEditor,
    }),
    createSlotExtension(UserMenuItemsSlot, {
      id: "dependency.user-menu.map",
      component: DependencyMenuItems,
      metadata: { group: "Workspace" },
    }),
  ],
});
