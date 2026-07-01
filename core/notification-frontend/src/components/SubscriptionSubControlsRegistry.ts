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

// Lazily initialised for the same reason as SubjectKindRegistry: `anomaly-
// frontend` registers its sub-controls as a top-level import side effect, so
// the exported function can run before this module body's field initialiser
// under some production bundle-evaluation orders (Safari's Module Federation
// order in particular). A function-scoped lazy init guarantees the registry is
// never undefined at call time.
let registry:
  | Map<string, SubscriptionSubControlsComponent<unknown>>
  | undefined;

function getRegistry(): Map<string, SubscriptionSubControlsComponent<unknown>> {
  if (!registry) {
    registry = new Map<string, SubscriptionSubControlsComponent<unknown>>();
  }
  return registry;
}

/**
 * Register a sub-control panel for a subscription spec. Most plugins
 * never call this — only the few that want sub-granularity (anomaly's
 * mute list).
 */
export function registerSubscriptionSubControls<TResource>(
  spec: NotificationSubscriptionSpec<TResource>,
  Component: SubscriptionSubControlsComponent<TResource>,
): void {
  getRegistry().set(
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
  return getRegistry().get(specId);
}
