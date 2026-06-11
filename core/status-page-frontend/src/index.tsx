import { createFrontendPlugin } from "@checkstack/frontend-api";
import { MonitorCheck } from "lucide-react";
import {
  pluginMetadata,
  statusPageRoutes,
  statusPublicRoutes,
  statusPageAccess,
} from "@checkstack/status-page-common";

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
    },
    {
      // PUBLIC: no access rule -> renders for anonymous visitors. Only calls the
      // single public endpoint, which enforces published + visibility + the
      // field allow-list server-side.
      route: statusPublicRoutes.routes.page,
      load: () =>
        import("./pages/PublicStatusPage").then((m) => ({
          default: m.PublicStatusPage,
        })),
      title: "Status",
    },
  ],
});
