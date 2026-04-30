import type { NotificationSubject } from "./schemas";

/**
 * Plugin-metadata shape relied on by the builders below. Mirrors the
 * `pluginId` field on the `definePluginMetadata` return type without
 * importing the rest of `@checkstack/common` into this file.
 */
interface PluginMetadataLike {
  pluginId: string;
}

/**
 * Returns a typed builder that produces `NotificationSubject` instances for
 * a specific plugin's local entity kind. The resulting `kind` string is
 * always namespaced as `<pluginId>.<localKind>`, so callers can never
 * forget the prefix and the namespace updates automatically if a plugin's
 * id changes.
 *
 * Example:
 * ```ts
 * import { createSubjectKindBuilder } from "@checkstack/notification-common";
 * import { pluginMetadata } from "./plugin-metadata";
 *
 * export const createSystemSubject = createSubjectKindBuilder(
 *   pluginMetadata,
 *   "system",
 * );
 *
 * // Elsewhere:
 * const subject = createSystemSubject({
 *   id: "sys-1",
 *   name: "Production DB",
 *   url: "/system/sys-1",
 * });
 * // -> { kind: "catalog.system", id: "sys-1", name: "Production DB", url: ... }
 * ```
 */
export function createSubjectKindBuilder(
  pluginMetadata: PluginMetadataLike,
  localKind: string,
): (props: {
  id: string;
  name: string;
  url?: string;
  status?: NotificationSubject["status"];
}) => NotificationSubject {
  const kind = `${pluginMetadata.pluginId}.${localKind}`;
  return (props) => ({
    kind,
    id: props.id,
    name: props.name,
    url: props.url,
    status: props.status,
  });
}

/**
 * Returns a builder that produces collapse keys for a specific plugin's
 * local entity kind. Output is `<pluginId>.<localKind>.<entityId>`, the
 * convention used by the frontend to collapse related notifications into a
 * single card.
 *
 * Example:
 * ```ts
 * import { createCollapseKeyBuilder } from "@checkstack/notification-common";
 * import { pluginMetadata } from "./plugin-metadata";
 *
 * export const incidentCollapseKey = createCollapseKeyBuilder(
 *   pluginMetadata,
 *   "incident",
 * );
 *
 * // Elsewhere:
 * incidentCollapseKey("inc-42"); // -> "incident.incident.inc-42"
 * ```
 *
 * The variadic suffix lets you scope keys further when the entity isn't a
 * single id (e.g., `(systemId, fieldPath)` for an anomaly).
 */
export function createCollapseKeyBuilder(
  pluginMetadata: PluginMetadataLike,
  localKind: string,
): (...entityIds: [string, ...string[]]) => string {
  const prefix = `${pluginMetadata.pluginId}.${localKind}`;
  return (...entityIds) => `${prefix}.${entityIds.join(".")}`;
}
