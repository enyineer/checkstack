import {
  createCollapseKeyBuilder,
  createSubscriptionFactory,
} from "@checkstack/notification-common";
import {
  catalogSystemTarget,
  catalogGroupTarget,
} from "@checkstack/catalog-common";
import { pluginMetadata } from "./plugin-metadata";

export const maintenanceCollapseKey = createCollapseKeyBuilder(
  pluginMetadata,
  "maintenance",
);

const { defineSubscription } = createSubscriptionFactory(pluginMetadata);

export const maintenanceSystemSubscription = defineSubscription({
  localId: "system",
  target: catalogSystemTarget,
  display: {
    title: "Maintenance",
    description: "Maintenance windows scheduled and updated for this system.",
    iconName: "Wrench",
  },
});

export const maintenanceGroupSubscription = defineSubscription({
  localId: "group",
  target: catalogGroupTarget,
  display: {
    title: "Maintenance",
    description: "Maintenance windows for any system in this group.",
    iconName: "Wrench",
  },
});
