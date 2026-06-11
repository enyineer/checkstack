import { z } from "zod";
import { createExtensionPoint, type RpcClient } from "@checkstack/backend-api";
import type { PluginMetadata } from "@checkstack/common";
import type { WidgetBindingKind } from "@checkstack/status-page-common";

/**
 * Extensible registry of status-page WIDGET TYPES. Mirrors the automation action
 * registry: a widget type carries a config schema (what the builder edits), a
 * public DTO schema (the field allow-list the public surface receives), a
 * declaration of which resources it binds (for edit-time authz + publish audit),
 * and a `resolvePublic` that turns a config into the public DTO.
 *
 * SECURITY: `resolvePublic` runs with the TRUSTED service `rpcClient` (so it can
 * read the bound resources regardless of the anonymous caller's grants), but it
 * MUST emit only its `dtoSchema` shape — never the source resource's internal
 * config, ids, or `createdBy`. The service validates the returned value against
 * `dtoSchema` before it leaves the backend, so a resolver bug fails closed.
 */

export interface WidgetResolveContext {
  /** Trusted service RPC client for reading bound resources' public-safe data. */
  rpcClient: RpcClient;
  /**
   * Per-page-resolve memoization. A resolver wraps an expensive read (e.g. the
   * full catalog, which has no fetch-by-ids endpoint) in `cache(key, loader)` so
   * many widgets on one page share a single fetch instead of O(widgets) scans
   * per public hit. Keys are resolver-chosen and scoped to a single resolve.
   */
  cache<T>(key: string, loader: () => Promise<T>): Promise<T>;
}

/** A resource a widget binds to, for edit-time access checks + publish audit. */
export interface BoundResource {
  /** Qualified resource type, e.g. "catalog.system". */
  resourceType: string;
  resourceId: string;
}

export interface WidgetTypeDefinition {
  /** Local id (qualified with the registering plugin id, e.g. "banner"). */
  id: string;
  displayName: string;
  description: string;
  category: string;
  binding: WidgetBindingKind;
  /**
   * The npm package of the FRONTEND plugin that ships this widget's renderer,
   * when it is NOT bundled into the status-page frontend (i.e. a third-party
   * widget). Built-in widgets omit it. Used only to tell the minimal
   * custom-domain public bundle which renderer remote to load for a page that
   * uses this widget; it is never required for the in-app `/status/<slug>` page.
   */
  rendererRemote?: string;
  /**
   * Validates + defaults the stored config. The service parses with this BEFORE
   * `resolvePublic`/`boundResources`, but each implementation also re-parses
   * (`config: unknown`) so it is independently type-safe and cast-free.
   */
  configSchema: z.ZodType;
  /** The public output shape (the allow-list). */
  dtoSchema: z.ZodType;
  /** Resources this config references (drives edit-time authz + audit). */
  boundResources(config: unknown): BoundResource[];
  /** Resolve the public DTO from a config using trusted reads. */
  resolvePublic(args: {
    config: unknown;
    ctx: WidgetResolveContext;
  }): Promise<unknown>;
  /**
   * Publish-time gate: throw if the EDITOR (the `userClient`, scoped to the
   * caller) cannot read every resource this config binds — "you cannot publish
   * what you cannot see". REQUIRED for any widget whose `boundResources` is
   * non-empty: the platform fails the publish CLOSED for a binding widget that
   * does not provide this (it owns the resource type, so it owns the check).
   * Content widgets (no bindings) omit it.
   */
  assertBindingsReadable?(args: {
    userClient: RpcClient;
    config: unknown;
  }): Promise<void>;
}

export interface RegisteredWidgetType extends WidgetTypeDefinition {
  qualifiedId: string;
  ownerPluginId: string;
}

export interface WidgetTypeRegistry {
  register(
    definition: WidgetTypeDefinition,
    pluginMetadata: PluginMetadata,
  ): void;
  get(qualifiedId: string): RegisteredWidgetType | undefined;
  list(): RegisteredWidgetType[];
}

export function createWidgetTypeRegistry(): WidgetTypeRegistry {
  const types = new Map<string, RegisteredWidgetType>();
  return {
    register(definition, pluginMetadata) {
      const qualifiedId = `${pluginMetadata.pluginId}.${definition.id}`;
      types.set(qualifiedId, {
        ...definition,
        qualifiedId,
        ownerPluginId: pluginMetadata.pluginId,
      });
    },
    get(qualifiedId) {
      return types.get(qualifiedId);
    },
    list() {
      return [...types.values()];
    },
  };
}

/** Extension point so any plugin can contribute a widget type. */
export interface StatusWidgetTypeExtensionPoint {
  registerWidgetType(
    definition: WidgetTypeDefinition,
    pluginMetadata: PluginMetadata,
  ): void;
}

export const statusWidgetTypeExtensionPoint =
  createExtensionPoint<StatusWidgetTypeExtensionPoint>(
    "statuspage.widgetTypeExtensionPoint",
  );
