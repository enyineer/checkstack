import {
  createFrontendPlugin,
  createSlotExtension,
} from "@checkstack/frontend-api";
import {
  pluginMetadata,
  dependencyRoutes,
  dependencyAccess,
} from "@checkstack/dependency-common";
import {
  SystemDetailsTopSlot,
  SystemStateBadgesSlot,
  SystemDetailsSlot,
} from "@checkstack/catalog-common";
import { DependencyBadge } from "./components/DependencyBadge";
import { DependencyAlert } from "./components/DependencyAlert";
import { DependencyEditor } from "./components/DependencyEditor";

export default createFrontendPlugin({
  metadata: pluginMetadata,
  routes: [
    {
      route: dependencyRoutes.routes.map,
      // Placeholder - will be implemented in Phase 4 with React Flow
      element: <div>Dependency Map (coming soon)</div>,
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
    createSlotExtension(SystemDetailsSlot, {
      id: "dependency.system-details.editor",
      component: DependencyEditor,
    }),
  ],
});
