import {
  createCollapseKeyBuilder,
  createSubscriptionFactory,
} from "@checkstack/notification-common";
import {
  catalogSystemTarget,
  catalogGroupTarget,
} from "@checkstack/catalog-common";
import { pluginMetadata } from "./plugin-metadata";

export const incidentCollapseKey = createCollapseKeyBuilder(
  pluginMetadata,
  "incident",
);

const { defineSubscription } = createSubscriptionFactory(pluginMetadata);

export const incidentSystemSubscription = defineSubscription({
  localId: "system",
  target: catalogSystemTarget,
  display: {
    title: "Incidents",
    description: "Incidents reported, updated, and resolved for this system.",
    iconName: "AlertTriangle",
  },
});

export const incidentGroupSubscription = defineSubscription({
  localId: "group",
  target: catalogGroupTarget,
  display: {
    title: "Incidents",
    description: "Incidents for any system in this group.",
    iconName: "AlertTriangle",
  },
});
