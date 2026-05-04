import { FrontendPlugin, DashboardSlot } from "@checkstack/frontend-api";
import { Dashboard } from "./Dashboard";
import { pluginMetadata } from "./pluginMetadata";

export const dashboardPlugin: FrontendPlugin = {
  metadata: pluginMetadata,
  extensions: [
    {
      id: "dashboard-main",
      slot: DashboardSlot,
      component: Dashboard as React.ComponentType<unknown>,
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
