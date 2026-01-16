import {
  UserMenuItemsSlot,
  createSlotExtension,
  createFrontendPlugin,
} from "@checkstack/frontend-api";
import { QueueConfigPage } from "./pages/QueueConfigPage";
import { QueueUserMenuItems } from "./components/UserMenuItems";
import {
  queueRoutes,
  pluginMetadata,
  queueAccess,
} from "@checkstack/queue-common";

export const queuePlugin = createFrontendPlugin({
  metadata: pluginMetadata,
  routes: [
    {
      route: queueRoutes.routes.config,
      element: <QueueConfigPage />,
      accessRule: queueAccess.settings.read,
    },
  ],
  extensions: [
    createSlotExtension(UserMenuItemsSlot, {
      id: "queue.user-menu.items",
      component: QueueUserMenuItems,
    }),
  ],
});

export * from "./api";
export { QueueLagAlert } from "./components/QueueLagAlert";
