import {
  createSubjectKindBuilder,
  defineNotificationTarget,
} from "@checkstack/notification-common";
import { pluginMetadata } from "./plugin-metadata";

/**
 * Builders for the catalog plugin's notification subject kinds. Use these
 * instead of constructing `NotificationSubject` literals so the kind
 * namespace stays in sync with the plugin id.
 */
export const createSystemSubject = createSubjectKindBuilder(
  pluginMetadata,
  "system",
);

export const createGroupSubject = createSubjectKindBuilder(
  pluginMetadata,
  "group",
);

// ─── Notification targets ────────────────────────────────────────────────────
// Catalog owns the platform's "system" and "group" target types. Emitting
// plugins (anomaly, incident, maintenance, healthcheck, ...) reference
// these objects directly when defining their subscription specs — no
// strings, no per-plugin lifecycle code.

export interface CatalogSystemResource {
  systemId: string;
  systemName: string;
}

export interface CatalogGroupResource {
  groupId: string;
  groupName: string;
}

/**
 * The "system" target type. Resources are the entries of catalog's
 * `systems` table; the catalog backend pushes them to notification-
 * backend whenever a system is created, renamed, or deleted, and
 * declares each system's parent catalog groups.
 *
 * `legacy.legacyGroupIdTemplate` covers users who were already
 * subscribed to the pre-pattern `catalog.system.<id>` group — the
 * notification backend seeds new spec groups from those subscribers
 * exactly once per (spec × resource) pair.
 */
export const catalogSystemTarget = defineNotificationTarget<CatalogSystemResource>({
  pluginMetadata,
  localId: "system",
  resourceKind: "system",
  keyOf: ({ systemId }) => systemId,
  labelOf: ({ systemName }) => systemName,
  parents: { targetTypeId: `${pluginMetadata.pluginId}.group` },
  legacy: { legacyGroupIdTemplate: "catalog.system.{resourceKey}" },
});

/**
 * The "group" target type. Catalog groups don't currently have parent
 * resources; emitting plugins targeting groups deliver only to direct
 * subscribers of the group.
 */
export const catalogGroupTarget = defineNotificationTarget<CatalogGroupResource>({
  pluginMetadata,
  localId: "group",
  resourceKind: "group",
  keyOf: ({ groupId }) => groupId,
  labelOf: ({ groupName }) => groupName,
  legacy: { legacyGroupIdTemplate: "catalog.group.{resourceKey}" },
});
