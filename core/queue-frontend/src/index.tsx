import { rpcApiRef, ApiRef } from "@checkmate/frontend-api";
import { SLOT_USER_MENU_ITEMS } from "@checkmate/common";
import { queueApiRef, type QueueApi } from "./api";
import { createFrontendPlugin } from "@checkmate/frontend-api";
import { QueueConfigPage } from "./pages/QueueConfigPage";
import { QueueUserMenuItems } from "./components/UserMenuItems";

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
      path: "/config",
      element: <QueueConfigPage />,
      permission: "queue.read",
    },
  ],
  extensions: [
    {
      id: "queue.user-menu.items",
      slotId: SLOT_USER_MENU_ITEMS,
      component: QueueUserMenuItems,
    },
  ],
});

export * from "./api";
