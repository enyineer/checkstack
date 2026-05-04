import {
  createFrontendPlugin,
  createSlotExtension,
} from "@checkstack/frontend-api";
import { InfrastructureTabsSlot } from "@checkstack/infrastructure-common";
import { pluginMetadata, cacheAccess } from "@checkstack/cache-common";
import { CacheInfrastructureTab } from "./components/CacheInfrastructureTab";
import { HardDrive } from "lucide-react";

export const cachePlugin = createFrontendPlugin({
  metadata: pluginMetadata,
  // No routes — the cache tab lives inside the infrastructure page.
  extensions: [
    createSlotExtension(InfrastructureTabsSlot, {
      id: "cache.infrastructure.tab",
      component: CacheInfrastructureTab,
      metadata: {
        label: "Cache",
        icon: HardDrive,
        readAccess: cacheAccess.settings.read,
        manageAccess: cacheAccess.settings.manage,
        order: 20,
      },
    }),
  ],
});
