import {
  UserMenuItemsSlot,
  createSlotExtension,
  createFrontendPlugin,
} from "@checkstack/frontend-api";
import {
  catalogRoutes,
  pluginMetadata,
  catalogAccess,
} from "@checkstack/catalog-common";

import { Server, FolderTree } from "lucide-react";
import { registerSubjectKind } from "@checkstack/notification-frontend";

import { lazy } from "react";
import { CatalogUserMenuItems } from "./components/UserMenuItems";

// Lazy-loaded so each page body is a per-route chunk, not in the initial load.
const CatalogPage = lazy(() =>
  import("./components/CatalogPage").then((m) => ({ default: m.CatalogPage })),
);
const CatalogConfigPage = lazy(() =>
  import("./components/CatalogConfigPage").then((m) => ({
    default: m.CatalogConfigPage,
  })),
);
const SystemDetailPage = lazy(() =>
  import("./components/SystemDetailPage").then((m) => ({
    default: m.SystemDetailPage,
  })),
);

// Notification subject kinds emitted by catalog (see catalog-common's
// `createSystemSubject` / `createGroupSubject`). Registered at module load
// so the notification bell + page render kind-appropriate icons.
registerSubjectKind(`${pluginMetadata.pluginId}.system`, {
  label: "System",
  icon: Server,
});
registerSubjectKind(`${pluginMetadata.pluginId}.group`, {
  label: "Group",
  icon: FolderTree,
});

export const catalogPlugin = createFrontendPlugin({
  metadata: pluginMetadata,
  // No APIs needed - components use usePluginClient() directly
  apis: [],
  routes: [
    {
      route: catalogRoutes.routes.home,
      element: <CatalogPage />,
    },
    {
      route: catalogRoutes.routes.config,
      element: <CatalogConfigPage />,
      accessRule: catalogAccess.system.manage,
    },
    {
      route: catalogRoutes.routes.systemDetail,
      element: <SystemDetailPage />,
    },
  ],
  extensions: [
    createSlotExtension(UserMenuItemsSlot, {
      id: "catalog.user-menu.items",
      component: CatalogUserMenuItems,
      metadata: { group: "Workspace" },
    }),
  ],
});

export * from "./api";
