import { accessPair, resourceType } from "@checkstack/common";

import { pluginMetadata } from "./plugin-metadata";

/**
 * Plugin-qualified resource type ids for the tracestream plugin's team-scopable
 * resources. Reference these (never a raw string) at capability call sites so a
 * typo fails typecheck.
 *
 * IMPORTANT: a resource's team grants are keyed on
 * `qualifyResourceType(pluginId, <the access rule's resource>)`, so this
 * constant MUST use the SAME noun passed to `accessPair` below ("stream").
 * See `.claude/rules/rlac.md`.
 */
export const tracestreamResourceTypes = {
  stream: resourceType(pluginMetadata, "stream"),
};

/**
 * Access rules for the tracestream plugin.
 *
 * - `read`: view a stream's metadata, traces, spans, service/operation stats
 *   and events. Not a default rule - trace content can be sensitive (URLs,
 *   attributes), so streams are opt-in per team grant or global rule.
 * - `manage`: create/update/delete streams, mint and revoke source tokens,
 *   and edit sampling/retention/caps config.
 */
export const tracestreamAccess = {
  ...accessPair(
    "stream",
    {
      read: {
        description:
          "Read trace streams, traces, spans, service stats and events",
      },
      manage: {
        description:
          "Manage trace streams, including source tokens (Warning: source tokens grant ingest access to the stream) and sampling/retention/caps settings",
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
export const tracestreamAccessRules = Object.values(tracestreamAccess);
