import { createFrontendPlugin } from "@checkstack/frontend-api";
import { registerInfrastructureTab } from "@checkstack/infrastructure-common";
import { pluginMetadata, cacheAccess } from "@checkstack/cache-common";
import { CacheConfigTab } from "./components/CacheConfigTab";
import { HardDrive } from "lucide-react";

// Register cache tab into the Infrastructure Configuration page
registerInfrastructureTab({
  id: "cache",
  pluginId: pluginMetadata.pluginId,
  label: "Cache",
  icon: HardDrive,
  component: CacheConfigTab,
  readAccess: cacheAccess.settings.read,
  manageAccess: cacheAccess.settings.manage,
  order: 20, // After queue (10)
});

export const cachePlugin = createFrontendPlugin({
  metadata: pluginMetadata,
  // No routes — the cache tab lives inside the infrastructure page
});
