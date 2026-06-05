import { createFrontendPlugin } from "@checkstack/frontend-api";
import { Server } from "lucide-react";
import {
  pluginMetadata,
  infrastructureRoutes,
} from "@checkstack/infrastructure-common";

export const infrastructurePlugin = createFrontendPlugin({
  metadata: pluginMetadata,
  routes: [
    {
      route: infrastructureRoutes.routes.config,
      load: () =>
        import("./pages/InfrastructureConfigPage").then((m) => ({
          default: m.InfrastructureConfigPage,
        })),
      title: "Infrastructure",
      // No accessRule here — the page handles per-tab access internally
      nav: {
        group: "Configuration",
        icon: Server,
        // Per-tab access is gated inside the page (tabs are contributed by
        // other plugins), so there is no single static rule to gate the
        // sidebar entry on.
      },
    },
  ],
});
