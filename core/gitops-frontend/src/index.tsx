import {
  createFrontendPlugin,
  createSlotExtension,
  UserMenuItemsSlot,
} from "@checkstack/frontend-api";
import {
  gitopsRoutes,
  pluginMetadata,
  gitopsAccess,
} from "@checkstack/gitops-common";

import { GitOpsPage } from "./pages/GitOpsPage";
import { GitOpsMenuItem } from "./components/GitOpsMenuItem";

export const gitopsPlugin = createFrontendPlugin({
  metadata: pluginMetadata,
  apis: [],
  routes: [
    {
      route: gitopsRoutes.routes.home,
      element: <GitOpsPage />,
      accessRule: gitopsAccess.provider.read,
    },
  ],
  extensions: [
    createSlotExtension(UserMenuItemsSlot, {
      id: "gitops.user-menu.link",
      component: GitOpsMenuItem,
    }),
  ],
});

// Public API for other frontend plugins
export { useProvenanceLock } from "./hooks/useProvenanceLock";
export { GitOpsLockBanner } from "./components/GitOpsLockBanner";
