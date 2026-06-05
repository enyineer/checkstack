import { createFrontendPlugin } from "@checkstack/frontend-api";
import {
  gitopsRoutes,
  pluginMetadata,
  gitopsAccess,
} from "@checkstack/gitops-common";
import { GitBranch, Blocks } from "lucide-react";

export const gitopsPlugin = createFrontendPlugin({
  metadata: pluginMetadata,
  apis: [],
  routes: [
    {
      route: gitopsRoutes.routes.home,
      load: () => import("./pages/GitOpsPage").then((m) => ({ default: m.GitOpsPage })),
      accessRule: gitopsAccess.provider.read,
      nav: {
        group: "Configuration",
        icon: GitBranch,
        label: "GitOps",
      },
    },
    {
      route: gitopsRoutes.routes.kinds,
      load: () =>
        import("./pages/KindRegistryPage").then((m) => ({
          default: m.KindRegistryPage,
        })),
      accessRule: gitopsAccess.kinds.read,
      nav: {
        group: "Documentation",
        icon: Blocks,
        label: "Kind Registry",
      },
    },
  ],
  extensions: [],
});

// Public API for other frontend plugins
export { useProvenanceLock } from "./hooks/useProvenanceLock";
export { useProvenanceLocks } from "./hooks/useProvenanceLocks";
export type { ProvenanceLock } from "./hooks/useProvenanceLocks";
export { GitOpsLockBanner } from "./components/GitOpsLockBanner";
export { GitOpsSourceBadge } from "./components/GitOpsSourceBadge";
