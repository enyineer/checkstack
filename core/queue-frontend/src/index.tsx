import { rpcApiRef, ApiRef, UserMenuItemsSlot } from "@checkmate/frontend-api";
import { queueApiRef, type QueueApi } from "./api";
import { createFrontendPlugin } from "@checkmate/frontend-api";
import { QueueConfigPage } from "./pages/QueueConfigPage";
import { QueueUserMenuItems } from "./components/UserMenuItems";
import { queueRoutes } from "@checkmate/queue-common";

export const queuePlugin = createFrontendPlugin({
  name: "queue-frontend",
  apis: [
    {
      ref: queueApiRef,
      factory: (deps: { get: <T>(ref: ApiRef<T>) => T }): QueueApi => {
        const rpcApi = deps.get(rpcApiRef);
        return rpcApi.forPlugin<QueueApi>("queue-backend");
      },
    },
  ],
  routes: [
    {
      route: queueRoutes.routes.config,
      element: <QueueConfigPage />,
      permission: "queue.read",
    },
  ],
  extensions: [
    {
      id: "queue.user-menu.items",
      slotId: UserMenuItemsSlot.id,
      component: QueueUserMenuItems,
    },
  ],
});

export * from "./api";
