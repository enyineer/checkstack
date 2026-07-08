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
  SystemDetailsSlot,
  SystemDetailsTopSlot,
  SystemStateBadgesSlot,
  SystemEditorSlot,
  SystemSignalsSlot,
  CatalogBrowseDataBoundarySlot,
} from "@checkstack/catalog-common";
import { DependencyBadge } from "./components/DependencyBadge";
import { DependencyAlert } from "./components/DependencyAlert";
import { CatalogBrowseDependencyDataFiller } from "./components/CatalogBrowseDependencyDataFiller";

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
      accessRule: dependencyAccess.map,
      nav: { group: "Workspace", icon: GitBranch },
    },
  ],
  apis: [],
  extensions: [
    createSlotExtension(SystemStateBadgesSlot, {
      id: "dependency.system-state-badge",
      component: DependencyBadge,
    }),
    // Eager filler for catalog's browse-view data boundary: wraps the whole
    // browse tree in DependencyBadgeDataProvider so the per-row DependencyBadge
    // reads bulk dependency warnings from context instead of fetching per row
    // (fixes the browse N+1). Eager (not lazy) so the provider is in place
    // before the first row renders and no badge falls back to its singular RPC.
    createSlotExtension(CatalogBrowseDataBoundarySlot, {
      id: "dependency.catalog.browse-dependency-data",
      component: CatalogBrowseDependencyDataFiller,
    }),
    createSlotExtension(SystemDetailsTopSlot, {
      id: "dependency.system-details-top.alert",
      component: DependencyAlert,
    }),
    createSlotExtension(SystemDetailsSlot, {
      id: "dependency.system-details.up-downstream",
      // Read-only up/downstream list, gated to dependency-map readers and
      // team managers of the system. Lazy-loaded to keep it off the initial
      // bundle until a system detail page renders.
      load: () =>
        import("./components/SystemDependenciesPanel").then((m) => ({
          default: m.SystemDependenciesPanel,
        })),
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
