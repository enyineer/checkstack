import type React from "react";
import type { StatusWidgetRendererProps } from "@checkstack/status-page-common";

/** A widget renderer: a pure component drawing a resolved DTO. */
export type WidgetRenderer = React.ComponentType<StatusWidgetRendererProps>;
/** Resolves a widget-type id to its renderer (built-in or plugin-contributed). */
export type WidgetRendererMap = ReadonlyMap<string, WidgetRenderer>;

/**
 * Merge built-in renderers with plugin-contributed ones. Built-ins WIN on an id
 * clash (the `statuspage.*` namespace is reserved), so a third-party plugin
 * cannot shadow a built-in renderer. Pure (no React/UI imports), so it is
 * unit-testable without pulling in the heavy renderer components.
 */
export function mergeWidgetRenderers(
  builtins: Record<string, WidgetRenderer>,
  contributed: ReadonlyArray<{ widgetTypeId: string; component: WidgetRenderer }>,
): WidgetRendererMap {
  const map = new Map<string, WidgetRenderer>(Object.entries(builtins));
  for (const { widgetTypeId, component } of contributed) {
    if (!map.has(widgetTypeId)) map.set(widgetTypeId, component);
  }
  return map;
}
