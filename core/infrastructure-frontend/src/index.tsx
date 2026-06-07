import { createFrontendPlugin, pluginRegistry } from "@checkstack/frontend-api";
import { isAccessRuleSatisfied } from "@checkstack/common";
import { Server } from "lucide-react";
import {
  pluginMetadata,
  infrastructureRoutes,
  InfrastructureTabsSlot,
  type InfrastructureTabMetadata,
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
      // No static accessRule — the tabs are contributed by other plugins at
      // runtime. Show the sidebar entry only when the user can READ at least one
      // contributed tab; otherwise the page would just render "Access Denied".
      nav: {
        group: "Configuration",
        icon: Server,
        isVisible: ({ accessRules }) =>
          pluginRegistry
            .getExtensions(InfrastructureTabsSlot.id)
            .some((extension) => {
              // `getExtensions` is keyed by slot id and therefore untyped; every
              // extension in THIS slot carries InfrastructureTabMetadata by the
              // slot contract, so reading `readAccess` off it is sound.
              const metadata = extension.metadata as
                | InfrastructureTabMetadata
                | undefined;
              return metadata
                ? isAccessRuleSatisfied(accessRules, metadata.readAccess)
                : false;
            }),
      },
    },
  ],
});
