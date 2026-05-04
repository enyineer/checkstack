import {
  createFrontendPlugin,
  createSlotExtension,
} from "@checkstack/frontend-api";
import { InfrastructureTabsSlot } from "@checkstack/infrastructure-common";
import { pluginMetadata, queueAccess } from "@checkstack/queue-common";
import { QueueInfrastructureTab } from "./components/QueueInfrastructureTab";
import { Gauge } from "lucide-react";

export const queuePlugin = createFrontendPlugin({
  metadata: pluginMetadata,
  // No routes — the queue tab lives inside the infrastructure page.
  extensions: [
    createSlotExtension(InfrastructureTabsSlot, {
      id: "queue.infrastructure.tab",
      component: QueueInfrastructureTab,
      metadata: {
        label: "Queue",
        icon: Gauge,
        readAccess: queueAccess.settings.read,
        manageAccess: queueAccess.settings.manage,
        order: 10,
      },
    }),
  ],
});

export * from "./api";
export { QueueLagAlert } from "./components/QueueLagAlert";
