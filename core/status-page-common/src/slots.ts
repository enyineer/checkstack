import type React from "react";
import type { PluginMetadata } from "@checkstack/common";
import { createSlot, createSlotExtension } from "@checkstack/frontend-api";

/**
 * Props a status-page widget renderer receives. A renderer is a PURE, prop-only
 * component: it draws the already-resolved, field-allow-listed `data` DTO and
 * makes no data call of its own. `data` is `unknown` here (each widget type
 * defines its own DTO); the renderer narrows it (typically by parsing the
 * widget's DTO schema).
 */
export interface StatusWidgetRendererProps {
  data: unknown;
  label?: string;
}

/** Identifies which widget type a contributed renderer draws. */
export interface StatusWidgetRendererMetadata {
  /** The qualified widget-type id, e.g. `myplugin.latency` (matches the block type). */
  widgetTypeId: string;
}

/**
 * Frontend counterpart of the backend `statusWidgetTypeExtensionPoint`. A plugin
 * that contributes a widget TYPE on the backend contributes its RENDERER here so
 * its widget actually draws on a status page. The status-page frontend resolves
 * a block's renderer by `widgetTypeId`; built-in renderers are always present,
 * plugin-contributed ones are merged in from this slot.
 *
 * This is a slot (not a backend-style extension point) because that is the
 * idiomatic frontend mechanism: plugins declare it in their `extensions[]` and
 * it is collected through the plugin registry with no extra lifecycle.
 */
export const StatusWidgetRendererSlot = createSlot<
  StatusWidgetRendererProps,
  StatusWidgetRendererMetadata
>("statuspage.widgetRenderer");

/**
 * Declare a status-page widget renderer for one of your widget types. Pass the
 * LOCAL widget id (the same `id` you gave the backend `registerWidgetType`) plus
 * your plugin metadata; the qualified id (`${pluginId}.${id}`) is computed for
 * you, exactly like the backend registry — so the renderer always matches the
 * block type and there is no prefix to keep in sync by hand. Put the result in
 * your frontend plugin's `extensions: [...]`:
 *
 * ```tsx
 * import { pluginMetadata } from "@checkstack/myplugin-common";
 *
 * createFrontendPlugin({
 *   metadata: pluginMetadata,
 *   extensions: [
 *     defineStatusWidgetRenderer({
 *       pluginMetadata,
 *       id: "latency", // -> resolves "myplugin.latency"
 *       component: LatencyRenderer,
 *     }),
 *   ],
 * });
 * ```
 *
 * The component MUST be pure and prop-only (it only ever receives the resolved
 * DTO) — that is what keeps a third-party widget unable to leak data.
 */
export function defineStatusWidgetRenderer(input: {
  pluginMetadata: PluginMetadata;
  /** Local widget-type id, e.g. `latency` (qualified to `${pluginId}.latency`). */
  id: string;
  component: React.ComponentType<StatusWidgetRendererProps>;
}) {
  const widgetTypeId = `${input.pluginMetadata.pluginId}.${input.id}`;
  return createSlotExtension(StatusWidgetRendererSlot, {
    id: `${widgetTypeId}.renderer`,
    component: input.component,
    metadata: { widgetTypeId },
  });
}
