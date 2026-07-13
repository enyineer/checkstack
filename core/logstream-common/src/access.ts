import { accessPair, resourceType } from "@checkstack/common";

import { pluginMetadata } from "./plugin-metadata";

/**
 * Plugin-qualified resource type ids for the logstream plugin's team-scopable
 * resources. Reference these (never a raw string) at capability call sites -
 * `useProcedureAccess`, `useCanAccessType`, `useResourceAccess`, and a route's
 * `manageCapability` - so a typo fails typecheck.
 *
 * IMPORTANT: a resource's team grants are keyed on
 * `qualifyResourceType(pluginId, <the access rule's resource>)`, so this constant
 * MUST use the SAME noun passed to `accessPair` below ("stream"). Naming them
 * differently is the health-check footgun (see `.claude/rules/rlac.md`): grants
 * key on one type while the frontend gate checks another, and team-scoped users
 * silently see no surface.
 */
export const logstreamResourceTypes = {
  stream: resourceType(pluginMetadata, "stream"),
};

/**
 * Access rules for the logstream plugin.
 *
 * - `read`: view a stream's metadata, events, patterns and aggregates. Not a
 *   default/public rule - log content can be sensitive, so streams are opt-in
 *   per team grant or global rule.
 * - `manage`: create/update/delete streams, mint and revoke source tokens, and
 *   edit sampling/retention config.
 */
export const logstreamAccess = {
  ...accessPair(
    "stream",
    {
      read: {
        description: "Read log streams, events, patterns and aggregates",
      },
      manage: {
        description:
          "Manage log streams, including source tokens (Warning: source tokens grant ingest access to the stream) and sampling/retention settings",
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
export const logstreamAccessRules = Object.values(logstreamAccess);
