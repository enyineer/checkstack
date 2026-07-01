import { createFrontendPlugin } from "@checkstack/frontend-api";
import { MonitorCheck } from "lucide-react";
import {
  pluginMetadata,
  statusPageRoutes,
  statusPublicRoutes,
  statusPageAccess,
  statusPageResourceTypes,
} from "@checkstack/status-page-common";

// Re-exported for the separate custom-domain public bundle (core/frontend's
// public-app), which renders the page WITHOUT the admin app or its router,
// driving the slug from `/api/config` instead of the URL. The bundle also
// provides `RendererRemotesProvider` so third-party widget renderers load on
// custom domains.
export { PublicStatusPageView } from "./pages/PublicStatusPage";
export {
  RendererRemotesProvider,
  useLoadRendererRemotes,
  type LoadRendererRemotes,
} from "./remote-renderers";

export default createFrontendPlugin({
  metadata: pluginMetadata,
  routes: [
    {
      route: statusPageRoutes.routes.list,
      load: () =>
        import("./pages/StatusPagesListPage").then((m) => ({
          default: m.StatusPagesListPage,
        })),
      title: "Status pages",
      accessRule: statusPageAccess.page.read,
      nav: { group: "Workspace", icon: MonitorCheck, label: "Status pages" },
    },
    {
      route: statusPageRoutes.routes.builder,
      load: () =>
        import("./pages/StatusPageBuilderPage").then((m) => ({
          default: m.StatusPageBuilderPage,
        })),
      title: "Status page builder",
      accessRule: statusPageAccess.page.manage,
      // Team-scoped: creating/managing a status page via a team unlocks the
      // builder even without the global manage rule.
      manageCapability: { objectType: statusPageResourceTypes.page },
    },
    {
      // PUBLIC: no access rule -> renders for anonymous visitors. `standalone`
      // renders it WITHOUT the admin chrome (no sidebar/header/command palette).
      // Only calls the single public endpoint, which enforces published +
      // visibility + the field allow-list server-side.
      route: statusPublicRoutes.routes.page,
      load: () =>
        import("./pages/PublicStatusPage").then((m) => ({
          default: m.PublicStatusPage,
        })),
      title: "Status",
      standalone: true,
    },
  ],
});
