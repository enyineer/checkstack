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
 * Extract the context type from a SlotDefinition
 */
export type SlotContext<T> = T extends SlotDefinition<infer C> ? C : never;

/**
 * Type-safe extension that infers component props from the slot definition.
 */
export interface Extension<
  TSlot extends SlotDefinition<unknown> = SlotDefinition<unknown>
> {
  id: string;
  slot: TSlot;
  component: React.ComponentType<SlotContext<TSlot>>;
}

/**
 * Helper to create a type-safe extension from a slot definition.
 * This ensures the component props match the slot's expected context.
 */
export function createSlotExtension<TSlot extends SlotDefinition<unknown>>(
  slot: TSlot,
  extension: Omit<Extension<TSlot>, "slot">
): Extension<TSlot> {
  return {
    ...extension,
    slot,
  };
}

/**
 * Route configuration for a frontend plugin.
 * Uses RouteDefinition from the plugin's common package.
 */
export interface PluginRoute {
  /** Route definition from common package */
  route: RouteDefinition;

  /** React element to render */
  element?: React.ReactNode;

  /** Page title */
  title?: string;

  /** Access rule required to access this route (use access object from common package) */
  accessRule?: AccessRule;
}

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
