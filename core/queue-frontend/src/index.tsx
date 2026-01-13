import {
  rpcApiRef,
  ApiRef,
  UserMenuItemsSlot,
  createSlotExtension,
  createFrontendPlugin,
} from "@checkstack/frontend-api";
import { queueApiRef, type QueueApiClient } from "./api";
import { QueueConfigPage } from "./pages/QueueConfigPage";
import { QueueUserMenuItems } from "./components/UserMenuItems";
import {
  queueRoutes,
  QueueApi,
  pluginMetadata,
  queueAccess,
} from "@checkstack/queue-common";

export const queuePlugin = createFrontendPlugin({
  metadata: pluginMetadata,
  apis: [
    {
      ref: queueApiRef,
      factory: (deps: { get: <T>(ref: ApiRef<T>) => T }): QueueApiClient => {
        const rpcApi = deps.get(rpcApiRef);
        return rpcApi.forPlugin(QueueApi);
      },
    },
  ],
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
