import { FrontendPlugin, DashboardSlot } from "@checkstack/frontend-api";
import { definePluginMetadata } from "@checkstack/common";
import { Dashboard } from "./Dashboard";

const pluginMetadata = definePluginMetadata({
  pluginId: "dashboard",
});

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
