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
import {
  SystemDetailsTopSlot,
  SystemStateBadgesSlot,
  SystemDetailsSlot,
} from "@checkstack/catalog-common";
import { DependencyBadge } from "./components/DependencyBadge";
import { DependencyAlert } from "./components/DependencyAlert";
import { DependencyEditor } from "./components/DependencyEditor";
import { DependencyMapPage } from "./components/DependencyMapPage";
import { DependencyMenuItems } from "./components/DependencyMenuItems";

export default createFrontendPlugin({
  metadata: pluginMetadata,
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
    createSlotExtension(SystemDetailsSlot, {
      id: "dependency.system-details.editor",
      component: DependencyEditor,
    }),
    createSlotExtension(UserMenuItemsSlot, {
      id: "dependency.user-menu.map",
      component: DependencyMenuItems,
    }),
  ],
});
