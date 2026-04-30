import {
  createCollapseKeyBuilder,
  createSubscriptionFactory,
} from "@checkstack/notification-common";
import {
  catalogSystemTarget,
  catalogGroupTarget,
} from "@checkstack/catalog-common";
import { pluginMetadata } from "./plugin-metadata";

export const dependencyUpstreamCollapseKey = createCollapseKeyBuilder(
  pluginMetadata,
  "upstream",
);

const { defineSubscription } = createSubscriptionFactory(pluginMetadata);

export const dependencySystemSubscription = defineSubscription({
  localId: "system",
  target: catalogSystemTarget,
  display: {
    title: "Dependency Impact",
    description:
      "Alerts when this system is impacted by an upstream dependency outage.",
    iconName: "GitBranch",
  },
});

export const dependencyGroupSubscription = defineSubscription({
  localId: "group",
  target: catalogGroupTarget,
  display: {
    title: "Dependency Impact",
    description:
      "Alerts when any system in this group is impacted by an upstream dependency outage.",
    iconName: "GitBranch",
  },
});
