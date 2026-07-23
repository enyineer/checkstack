import type { PluginMetadata } from "@checkstack/common";

export const pluginMetadata: PluginMetadata = {
  pluginId: "k8s-events",
};

/** Local source-type id (qualified with the plugin id at registration). */
export const K8S_EVENTS_TYPE_ID = "k8s-events";

/**
 * Qualified source type id: `${pluginId}.${typeId}`. This is the key the
 * satellite executor registry is keyed on, and the id the frontend catalog
 * descriptor carries.
 */
export const K8S_EVENTS_SOURCE_TYPE_ID = `${pluginMetadata.pluginId}.${K8S_EVENTS_TYPE_ID}`;
