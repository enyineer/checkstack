import { extractErrorMessage } from "@checkstack/common";
import type { Logger } from "@checkstack/backend-api";
import type { StatusPageLayout, SubscribableSystem } from "@checkstack/status-page-common";
import type {
  WidgetResolveContext,
  WidgetTypeRegistry,
} from "./widget-registry";

/**
 * Resolve the union of catalog system ids a published layout CURRENTLY surfaces
 * through its event-feed widgets, via each widget's own `resolveScopedSystems`
 * (the single live scope source the fan-out also uses, so nothing can drift).
 * Fails CLOSED per widget: a resolver error contributes nothing.
 *
 * Used by the subscribe path to CLAMP a submitted `systemIds` to what the page
 * actually shows, so the endpoint never confirms or denies a hidden system.
 */
export async function resolveSurfacedSystemIds(args: {
  layout: StatusPageLayout;
  registry: WidgetTypeRegistry;
  ctx: WidgetResolveContext;
  logger: Logger;
  slug: string;
}): Promise<Set<string>> {
  const { layout, registry, ctx, logger, slug } = args;
  const out = new Set<string>();
  for (const block of layout) {
    const widget = registry.get(block.type);
    if (!widget?.resolveScopedSystems) continue;
    try {
      const scope = await widget.resolveScopedSystems({
        config: block.config,
        ctx,
      });
      for (const id of scope) out.add(id);
    } catch (error) {
      logger.warn("status-page scoped-systems resolve failed", {
        slug,
        blockType: block.type,
        error: extractErrorMessage(error),
      });
    }
  }
  return out;
}

/**
 * Resolve the surfaced systems WITH public display names for the subscribe form,
 * via each widget's `resolveScopedSystemsDetailed`. Deduped by id (first name
 * wins); fails CLOSED per widget. Returns a stable, name-sorted list so the
 * public picker order is deterministic.
 */
export async function resolveSubscribableSystems(args: {
  layout: StatusPageLayout;
  registry: WidgetTypeRegistry;
  ctx: WidgetResolveContext;
  logger: Logger;
  slug: string;
}): Promise<SubscribableSystem[]> {
  const { layout, registry, ctx, logger, slug } = args;
  const byId = new Map<string, string>();
  for (const block of layout) {
    const widget = registry.get(block.type);
    if (!widget?.resolveScopedSystemsDetailed) continue;
    try {
      const systems = await widget.resolveScopedSystemsDetailed({
        config: block.config,
        ctx,
      });
      for (const s of systems) {
        if (!byId.has(s.id)) byId.set(s.id, s.name);
      }
    } catch (error) {
      logger.warn("status-page subscribable-systems resolve failed", {
        slug,
        blockType: block.type,
        error: extractErrorMessage(error),
      });
    }
  }
  return [...byId.entries()]
    .map(([id, name]) => ({ id, name }))
    .toSorted((a, b) => a.name.localeCompare(b.name));
}
