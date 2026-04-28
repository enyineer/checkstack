import { createFrontendPlugin } from "@checkstack/frontend-api";
import { registerInfrastructureTab } from "@checkstack/infrastructure-common";
import { pluginMetadata, queueAccess } from "@checkstack/queue-common";
import { QueueConfigTab } from "./components/QueueConfigTab";
import { Gauge } from "lucide-react";

// Register queue tab into the Infrastructure Configuration page
registerInfrastructureTab({
  id: "queue",
  pluginId: pluginMetadata.pluginId,
  label: "Queue",
  icon: Gauge,
  component: QueueConfigTab,
  readAccess: queueAccess.settings.read,
  manageAccess: queueAccess.settings.manage,
  order: 10, // First tab
});

export const queuePlugin = createFrontendPlugin({
  metadata: pluginMetadata,
  // No routes — the queue tab lives inside the infrastructure page now
  // Former standalone /queue/config route is replaced by /infrastructure/config
});

export * from "./api";
export { QueueLagAlert } from "./components/QueueLagAlert";
