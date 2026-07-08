import {
  FrontendPlugin,
  DashboardSlot,
  createSlotExtension,
} from "@checkstack/frontend-api";
import { CatalogBrowseDataBoundarySlot } from "@checkstack/catalog-common";
import { pluginMetadata } from "./pluginMetadata";
import { CatalogBrowseBadgeDataFiller } from "./components/CatalogBrowseBadgeDataFiller";

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
    // Eager filler for catalog's browse-view data boundary: wraps the whole
    // browse tree in SystemBadgeDataProvider so the per-row health / incident /
    // maintenance badges read bulk data from context instead of fetching per row
    // (fixes the browse N+1). Eager (not lazy) so the provider is in place before
    // the first row renders and no badge falls back to its singular RPC.
    createSlotExtension(CatalogBrowseDataBoundarySlot, {
      id: "dashboard.catalog.browse-badge-data",
      component: CatalogBrowseBadgeDataFiller,
    }),
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
