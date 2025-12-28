import { fetchApiRef, ApiRef } from "@checkmate/frontend-api";
import { SLOT_USER_MENU_ITEMS } from "@checkmate/common";
import { QueueApiClient } from "./api";
import { queueApiRef } from "./api";
import { createFrontendPlugin } from "@checkmate/frontend-api";
import { QueueConfigPage } from "./pages/QueueConfigPage";
import { QueueUserMenuItems } from "./components/UserMenuItems";
import { permissions } from "@checkmate/queue-common";

export const queuePlugin = createFrontendPlugin({
  name: "queue-frontend",
  apis: [
    {
      ref: queueApiRef,
      factory: (deps: { get: <T>(ref: ApiRef<T>) => T }) => {
        const fetchApi = deps.get(fetchApiRef);
        return new QueueApiClient(fetchApi);
      },
    },
  ],
  routes: [
    {
      path: "/queue",
      element: <QueueConfigPage />,
      permission: permissions.queueRead.id,
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
