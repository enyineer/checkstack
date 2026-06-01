import { FrontendPlugin, DashboardSlot } from "@checkstack/frontend-api";
import { pluginMetadata } from "./pluginMetadata";

export const dashboardPlugin: FrontendPlugin = {
  metadata: pluginMetadata,
  extensions: [
    {
      id: "dashboard-main",
      slot: DashboardSlot,
      // Heavy dashboard (widgets/charts) — lazy so it stays out of the initial
      // bundle; it renders only on the "/" dashboard route.
      load: () =>
        import("./Dashboard").then((m) => ({
          default: m.Dashboard as React.ComponentType<unknown>,
        })),
    },
  ],
};

export default dashboardPlugin;

// Export provider for use in other plugins
export {
  SystemBadgeDataProvider,
  useSystemBadgeData,
  useSystemBadgeDataOptional,
  type SystemBadgeData,
} from "./components/SystemBadgeDataProvider";
