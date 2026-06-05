import { createFrontendPlugin } from "@checkstack/frontend-api";
import { createRoutes } from "@checkstack/common";
import { pluginMetadata, apiDocsAccess } from "@checkstack/api-docs-common";
import { FileCode2 } from "lucide-react";

export const apiDocsRoutes = createRoutes(pluginMetadata.pluginId, {
  docs: "/",
});

export const apiDocsPlugin = createFrontendPlugin({
  metadata: pluginMetadata,
  routes: [
    {
      route: apiDocsRoutes.routes.docs,
      load: () => import("./ApiDocsPage").then((m) => ({ default: m.ApiDocsPage })),
      accessRule: apiDocsAccess.view,
      nav: {
        group: "Documentation",
        icon: FileCode2,
        label: "API Documentation",
      },
    },
  ],
});

export default apiDocsPlugin;
