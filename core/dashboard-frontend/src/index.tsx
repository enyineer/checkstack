import {
  FrontendPlugin,
  DashboardSlot,
} from "@checkstack/frontend-api";
import { pluginMetadata } from "./pluginMetadata";

export const dashboardPlugin: FrontendPlugin = {
  metadata: pluginMetadata,
  extensions: [
    {
      id: "dashboard.welcome",
      slot: DashboardSlot,
      metadata: { priority: 0 },
      load: () =>
        import("./components/DashboardWelcomeSection").then((m) => ({
          default:
            m.DashboardWelcomeSection as React.ComponentType<unknown>,
        })),
    },
    {
      id: "dashboard.system-health",
      slot: DashboardSlot,
      metadata: { priority: 10 },
      load: () =>
        import("./components/DashboardSystemHealthSection").then((m) => ({
          default:
            m.DashboardSystemHealthSection as React.ComponentType<unknown>,
        })),
    },
    {
      id: "dashboard.recent-activity",
      slot: DashboardSlot,
      metadata: { priority: 30 },
      load: () =>
        import("./components/DashboardRecentActivitySection").then((m) => ({
          default:
            m.DashboardRecentActivitySection as React.ComponentType<unknown>,
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
