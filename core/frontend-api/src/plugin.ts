import React from "react";
import { ApiRef } from "./api-ref";
import type { SlotDefinition } from "./slots";
import type {
  RouteDefinition,
  PluginMetadata,
  AccessRule,
} from "@checkstack/common";
import type { Signal } from "@checkstack/signal-common";

/**
 * Extract the context type from a SlotDefinition.
 */
export type SlotContext<T> = T extends SlotDefinition<infer C, unknown>
  ? C
  : never;

/**
 * Extract the metadata type from a SlotDefinition.
 */
export type SlotMetadata<T> = T extends SlotDefinition<unknown, infer M>
  ? M
  : never;

/**
 * Type-safe extension that infers component props and metadata from the
 * slot definition.
 *
 * The `metadata` field is always declared as optional on the base interface
 * so that aggregate types like `Extension[]` (used in
 * {@link FrontendPlugin.extensions}) accept extensions for slots that don't
 * declare metadata. The required-vs-optional distinction is enforced at
 * registration time by {@link createSlotExtension}, which narrows the input
 * shape based on the slot's metadata parameter.
 */
export interface Extension<
  TSlot extends SlotDefinition<unknown, unknown> = SlotDefinition<
    unknown,
    unknown
  >
> {
  id: string;
  slot: TSlot;
  /**
   * Eager component. Use for LIGHT, always-rendered contributions (navbar,
   * user-menu items) where code-splitting would just add a load flash. Exactly
   * one of `component` / `load` is set.
   */
  component?: React.ComponentType<SlotContext<TSlot>>;
  /**
   * Lazy loader for HEAVY or page-scoped contributions. The framework wraps it
   * in React.lazy + Suspense + a per-plugin error boundary (see
   * `getLazyContribution`), so the chunk loads on demand and a failure is
   * contained to this contribution. Named exports: `() => import("./X").then(
   * (m) => ({ default: m.X }))`.
   */
  load?: () => Promise<{
    default: React.ComponentType<SlotContext<TSlot>>;
  }>;
  metadata?: SlotMetadata<TSlot>;
}

/** A contribution is provided either eagerly (`component`) or lazily (`load`). */
type SlotExtensionImpl<TSlot extends SlotDefinition<unknown, unknown>> =
  | {
      component: React.ComponentType<SlotContext<TSlot>>;
      load?: never;
    }
  | {
      load: () => Promise<{
        default: React.ComponentType<SlotContext<TSlot>>;
      }>;
      component?: never;
    };

/**
 * Input shape for `createSlotExtension`. Requires `metadata` when the slot
 * declares a non-`undefined` metadata type, forbids it otherwise, and requires
 * exactly one of `component` (eager) / `load` (lazy).
 */
type SlotExtensionInput<TSlot extends SlotDefinition<unknown, unknown>> =
  SlotMetadata<TSlot> extends undefined
    ? { id: string; metadata?: undefined } & SlotExtensionImpl<TSlot>
    : { id: string; metadata: SlotMetadata<TSlot> } & SlotExtensionImpl<TSlot>;

/**
 * Helper to create a type-safe extension from a slot definition.
 * Ensures the component props match the slot's expected context and that
 * `metadata` matches the slot's metadata contract (required when the slot
 * declares typed metadata, forbidden otherwise).
 */
export function createSlotExtension<
  TSlot extends SlotDefinition<unknown, unknown>
>(slot: TSlot, extension: SlotExtensionInput<TSlot>): Extension<TSlot> {
  return {
    ...extension,
    slot,
  } as Extension<TSlot>;
}

/**
 * Route configuration for a frontend plugin.
 * Uses RouteDefinition from the plugin's common package.
 */
/** Fields common to every route, regardless of eager/lazy. */
interface PluginRouteBase {
  /** Route definition from common package */
  route: RouteDefinition;
  /** Page title */
  title?: string;
  /** Access rule required to access this route (use access object from common package) */
  accessRule?: AccessRule;
}

/**
 * Route configuration for a frontend plugin. Provide EXACTLY one of:
 *  - `load` (default): a lazy page loader. The framework code-splits the page
 *    and wraps it in Suspense + a per-plugin error boundary (see
 *    `getLazyContribution`), so the chunk is fetched on navigation, never in
 *    the initial load. Named-export pages: `() => import("./pages/Foo").then(
 *    (m) => ({ default: m.Foo }))`.
 *  - `element`: an eagerly-rendered element. Reserve for the rare page that
 *    must paint without a chunk fetch (e.g. the login page on the
 *    unauthenticated critical path).
 */
export type PluginRoute = PluginRouteBase &
  (
    | { load: () => Promise<{ default: React.ComponentType }>; element?: never }
    | { element: React.ReactNode; load?: never }
  );

/**
 * Frontend plugin configuration.
 * Uses PluginMetadata from the common package for consistent plugin identification.
 */
export interface FrontendPlugin {
  /** Plugin metadata from the common package (contains pluginId) */
  metadata: PluginMetadata;
  extensions?: Extension[];
  apis?: {
    ref: ApiRef<unknown>;
    factory: (deps: { get: <T>(ref: ApiRef<T>) => T }) => unknown;
  }[];
  routes?: PluginRoute[];

  /**
   * Foreign signals that should also invalidate this plugin's react-query
   * cache (`[[pluginId]]`) when received. The signal's own plugin will already
   * be auto-invalidated; this opts the current plugin in as well.
   *
   * Use ONLY for genuine cross-plugin reactivity (e.g. dependency-frontend
   * needs to refetch when healthcheck status changes because dependency
   * payloads embed system status). Same-plugin signals are handled
   * automatically and must not be listed here.
   */
  foreignSignals?: Signal<unknown>[];
}

export function createFrontendPlugin(plugin: FrontendPlugin): FrontendPlugin {
  return plugin;
}
