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
 * Collapse key for system-health transition notifications driven by health
 * checks. Frontend merges health-state changes (degraded → unhealthy →
 * healthy) for the same system into a single card.
 */
export const systemHealthCollapseKey = createCollapseKeyBuilder(
  pluginMetadata,
  "system-health",
);

const { defineSubscription } = createSubscriptionFactory(pluginMetadata);

export const healthcheckSystemSubscription = defineSubscription({
  localId: "system",
  target: catalogSystemTarget,
  display: {
    title: "Health Status",
    description:
      "Healthy / degraded / unhealthy transitions detected by health checks for this system.",
    iconName: "Heart",
  },
});

export const healthcheckGroupSubscription = defineSubscription({
  localId: "group",
  target: catalogGroupTarget,
  display: {
    title: "Health Status",
    description: "Health-status transitions for any system in this group.",
    iconName: "Heart",
  },
});
