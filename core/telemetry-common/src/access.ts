import { accessPair, resourceType } from "@checkstack/common";

import { pluginMetadata } from "./plugin-metadata";

/**
 * Plugin-qualified resource type ids for the telemetry plugin's team-scopable
 * resources. Reference these (never a raw string) at capability call sites -
 * `useProcedureAccess`, `useCanAccessType`, `useResourceAccess`, and a route's
 * `manageCapability` - so a typo fails typecheck.
 *
 * IMPORTANT: a resource's team grants are keyed on
 * `qualifyResourceType(pluginId, <the access rule's resource>)`, so this
 * constant MUST use the SAME noun passed to `accessPair` below ("source").
 * Naming them differently is the health-check footgun (see
 * `.claude/rules/rlac.md`).
 */
export const telemetryResourceTypes = {
  source: resourceType(pluginMetadata, "source"),
};

/**
 * Access rules for the telemetry plugin.
 *
 * - `read`: view source instances (name, type, bindings, non-secret config)
 *   and the source-type catalog. NOT a default rule - source configs reveal
 *   infrastructure endpoints, so sources are opt-in per team grant or global
 *   rule.
 * - `manage`: create/update/delete source instances, rotate webhook secrets
 *   and run config tests. Binding a source to a stream ADDITIONALLY requires
 *   manage on that stream, enforced via the owning sink's `assertBindable`.
 */
export const telemetryAccess = {
  ...accessPair(
    "source",
    {
      read: {
        description:
          "Read telemetry source instances and the source-type catalog",
      },
      manage: {
        description:
          "Manage telemetry source instances, including their stream bindings, webhook secrets and connection tests (binding a stream also requires manage on that stream)",
      },
    },
    {
      // Owning plugin id - rules are matched only as `{pluginId}.{id}`.
      pluginId: pluginMetadata.pluginId,
    },
  ),
};

/**
 * All access rules for registration with the plugin system.
 */
export const telemetryAccessRules = Object.values(telemetryAccess);
