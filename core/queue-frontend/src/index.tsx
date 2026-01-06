import {
  rpcApiRef,
  ApiRef,
  UserMenuItemsSlot,
} from "@checkmate-monitor/frontend-api";
import { queueApiRef, type QueueApiClient } from "./api";
import { createFrontendPlugin } from "@checkmate-monitor/frontend-api";
import { QueueConfigPage } from "./pages/QueueConfigPage";
import { QueueUserMenuItems } from "./components/UserMenuItems";
import {
  queueRoutes,
  QueueApi,
  pluginMetadata,
  permissions,
} from "@checkmate-monitor/queue-common";

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
      permission: permissions.queueRead,
    },
  ],
  extensions: [
    {
      id: "queue.user-menu.items",
      slot: UserMenuItemsSlot,
      component: QueueUserMenuItems,
    },
  ],
});

export * from "./api";
