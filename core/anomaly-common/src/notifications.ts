import {
  createCollapseKeyBuilder,
  createSubscriptionFactory,
} from "@checkstack/notification-common";
import {
  catalogSystemTarget,
  catalogGroupTarget,
} from "@checkstack/catalog-common";
import { pluginMetadata } from "./plugin-metadata";

/**
 * Collapse key for anomaly lifecycle events (confirmed, recovered, drift
 * variants) for a specific (system, fieldPath) pair.
 */
export const anomalyCollapseKey = createCollapseKeyBuilder(
  pluginMetadata,
  "anomaly",
);

const { defineSubscription } = createSubscriptionFactory(pluginMetadata);

/**
 * Anomaly notifications for one specific system. Notification-backend
 * resolves the resource (and its parent catalog groups, via the target's
 * declared parent edges) at dispatch time — anomaly-backend just calls
 * `notifyForSubscription({ specId, resourceKeys: [systemId], ... })`.
 */
export const anomalySystemSubscription = defineSubscription({
  localId: "system",
  target: catalogSystemTarget,
  display: {
    title: "Anomaly Detection",
    description:
      "Spike and drift alerts for this system's metrics. Fields can be muted individually once subscribed.",
    iconName: "Activity",
  },
});

/**
 * Anomaly notifications for every system in a catalog group.
 */
export const anomalyGroupSubscription = defineSubscription({
  localId: "group",
  target: catalogGroupTarget,
  display: {
    title: "Anomaly Detection",
    description: "Spike and drift alerts for every system in this group.",
    iconName: "Activity",
  },
});
