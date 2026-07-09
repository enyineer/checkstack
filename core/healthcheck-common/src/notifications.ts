import {
  createCollapseKeyBuilder,
  createSubjectKindBuilder,
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

/**
 * Builder for the `healthcheck.healthcheck` notification subject kind. Used to
 * name the failing check(s) that drove a system-health transition alongside
 * the `catalog.system` subject, so subscribers see WHICH check triggered the
 * alert, not just which system. The local kind matches the access-rule
 * resource noun (`resourceType(pluginMetadata, "healthcheck")`).
 */
export const createHealthcheckSubject = createSubjectKindBuilder(
  pluginMetadata,
  "healthcheck",
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
