import type { ComponentType } from "react";
import type { NotificationSubscriptionSpec } from "@checkstack/notification-common";

/**
 * Optional per-spec sub-control panel — anomaly's per-field mute list,
 * future severity / channel filters, etc. The dialog renders rows from
 * the backend's spec registry (single source of truth), but plugins
 * that want sub-granularity register their React component here keyed
 * by `specId`.
 *
 * Registration is idempotent — re-registering the same spec overwrites
 * the prior entry.
 */
export type SubscriptionSubControlsComponent<TResource = unknown> =
  ComponentType<{
    resource: TResource;
    groupId: string;
  }>;

const registry = new Map<string, SubscriptionSubControlsComponent<unknown>>();

/**
 * Register a sub-control panel for a subscription spec. Most plugins
 * never call this — only the few that want sub-granularity (anomaly's
 * mute list).
 */
export function registerSubscriptionSubControls<TResource>(
  spec: NotificationSubscriptionSpec<TResource>,
  Component: SubscriptionSubControlsComponent<TResource>,
): void {
  registry.set(
    spec.specId,
    Component as SubscriptionSubControlsComponent<unknown>,
  );
}

/**
 * Look up the registered sub-control component for a spec id; returns
 * undefined when none was registered.
 */
export function getSubscriptionSubControls(
  specId: string,
): SubscriptionSubControlsComponent<unknown> | undefined {
  return registry.get(specId);
}
