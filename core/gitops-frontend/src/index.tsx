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
import { KindRegistryPage } from "./pages/KindRegistryPage";
import { GitOpsMenuItem } from "./components/GitOpsMenuItem";
import { KindRegistryMenuItem } from "./components/KindRegistryMenuItem";

export const gitopsPlugin = createFrontendPlugin({
  metadata: pluginMetadata,
  apis: [],
  routes: [
    {
      route: gitopsRoutes.routes.home,
      element: <GitOpsPage />,
      accessRule: gitopsAccess.provider.read,
    },
    {
      route: gitopsRoutes.routes.kinds,
      element: <KindRegistryPage />,
      accessRule: gitopsAccess.kinds.read,
    },
  ],
  extensions: [
    createSlotExtension(UserMenuItemsSlot, {
      id: "gitops.user-menu.link",
      component: GitOpsMenuItem,
    }),
    createSlotExtension(UserMenuItemsSlot, {
      id: "gitops.user-menu.kind-registry",
      component: KindRegistryMenuItem,
    }),
  ],
});

// Public API for other frontend plugins
export { useProvenanceLock } from "./hooks/useProvenanceLock";
export { useProvenanceLocks } from "./hooks/useProvenanceLocks";
export type { ProvenanceLock } from "./hooks/useProvenanceLocks";
export { GitOpsLockBanner } from "./components/GitOpsLockBanner";
export { GitOpsSourceBadge } from "./components/GitOpsSourceBadge";
