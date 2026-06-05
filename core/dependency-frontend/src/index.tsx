import {
  createFrontendPlugin,
  createSlotExtension,
} from "@checkstack/frontend-api";
import { GitBranch } from "lucide-react";
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
  SystemSignalsSlot,
} from "@checkstack/catalog-common";
import { DependencyBadge } from "./components/DependencyBadge";
import { DependencyAlert } from "./components/DependencyAlert";

export default createFrontendPlugin({
  metadata: pluginMetadata,
  // Dependency queries embed system health, so a system status change must
  // also invalidate this plugin's cache. Same-plugin signals (DEPENDENCY_*)
  // are auto-invalidated and must NOT be listed here.
  foreignSignals: [SYSTEM_STATUS_CHANGED],
  routes: [
    {
      route: dependencyRoutes.routes.map,
      load: () =>
        import("./components/DependencyMapPage").then((m) => ({
          default: m.DependencyMapPage,
        })),
      title: "Dependency Map",
      accessRule: dependencyAccess.dependency.read,
      nav: { group: "Workspace", icon: GitBranch },
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
      // Heavy editor form — lazy-loaded so it stays out of the initial bundle
      // and loads only when a system's editor slot renders.
      load: () =>
        import("./components/DependencyEditor").then((m) => ({
          default: m.DependencyEditor,
        })),
    }),
    createSlotExtension(SystemSignalsSlot, {
      id: "dependency.dashboard.signals",
      load: () =>
        import("./components/DependencySignalsFiller").then((m) => ({
          default: m.DependencySignalsFiller,
        })),
    }),
  ],
});
