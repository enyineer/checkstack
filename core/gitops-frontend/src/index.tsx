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

import { GitOpsMenuItem } from "./components/GitOpsMenuItem";
import { KindRegistryMenuItem } from "./components/KindRegistryMenuItem";

export const gitopsPlugin = createFrontendPlugin({
  metadata: pluginMetadata,
  apis: [],
  routes: [
    {
      route: gitopsRoutes.routes.home,
      load: () => import("./pages/GitOpsPage").then((m) => ({ default: m.GitOpsPage })),
      accessRule: gitopsAccess.provider.read,
    },
    {
      route: gitopsRoutes.routes.kinds,
      load: () =>
        import("./pages/KindRegistryPage").then((m) => ({
          default: m.KindRegistryPage,
        })),
      accessRule: gitopsAccess.kinds.read,
    },
  ],
  extensions: [
    createSlotExtension(UserMenuItemsSlot, {
      id: "gitops.user-menu.link",
      component: GitOpsMenuItem,
      metadata: { group: "Configuration" },
    }),
    createSlotExtension(UserMenuItemsSlot, {
      id: "gitops.user-menu.kind-registry",
      component: KindRegistryMenuItem,
      metadata: { group: "Documentation" },
    }),
  ],
});

// Public API for other frontend plugins
export { useProvenanceLock } from "./hooks/useProvenanceLock";
export { useProvenanceLocks } from "./hooks/useProvenanceLocks";
export type { ProvenanceLock } from "./hooks/useProvenanceLocks";
export { GitOpsLockBanner } from "./components/GitOpsLockBanner";
export { GitOpsSourceBadge } from "./components/GitOpsSourceBadge";
