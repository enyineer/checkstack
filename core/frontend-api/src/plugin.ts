import React from "react";
import { ApiRef } from "./api-ref";
import type { SlotDefinition } from "./slots";

/**
 * Extract the context type from a SlotDefinition
 */
export type SlotContext<T> = T extends SlotDefinition<infer C> ? C : never;

/**
 * Type-safe extension that infers component props from the slot definition.
 * Use this when registering extensions for type safety.
 */
export interface SlotExtension<TSlot extends SlotDefinition<unknown>> {
  id: string;
  slotId: TSlot["id"];
  component: React.ComponentType<SlotContext<TSlot>>;
}

/**
 * Legacy extension interface for backward compatibility.
 * @deprecated Use SlotExtension for type-safe extensions
 */
export interface Extension<T = unknown> {
  id: string;
  slotId: string;
  component: React.ComponentType<T>;
}

/**
 * Helper to create a type-safe extension from a slot definition.
 * This ensures the component props match the slot's expected context.
 */
export function createSlotExtension<TSlot extends SlotDefinition<unknown>>(
  slot: TSlot,
  extension: Omit<SlotExtension<TSlot>, "slotId">
): SlotExtension<TSlot> {
  return {
    ...extension,
    slotId: slot.id,
  };
}

// Type that accepts both legacy Extension and new SlotExtension
type AnyExtension = Extension<unknown> | SlotExtension<SlotDefinition<unknown>>;

export interface FrontendPlugin {
  name: string;
  extensions?: AnyExtension[];
  apis?: {
    ref: ApiRef<unknown>;
    factory: (deps: { get: <T>(ref: ApiRef<T>) => T }) => unknown;
  }[];
  routes?: {
    path: string;
    element?: React.ReactNode;
    title?: string;
    permission?: string;
  }[];
  navItems?: {
    title: string;
    path: string;
    icon?: React.ComponentType | React.ReactNode;
  }[];
}

export function createFrontendPlugin(plugin: FrontendPlugin): FrontendPlugin {
  return plugin;
}
