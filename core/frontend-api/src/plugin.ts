import React from "react";
import { ApiRef } from "./api-ref";
import type { SlotDefinition } from "./slots";
import type {
  RouteDefinition,
  PluginMetadata,
  AccessRule,
  ResourceType,
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
/**
 * Team-capability gate for a management route/nav entry. When present, the route
 * guard and the sidebar treat the surface as accessible if the user holds the
 * route's global `accessRule` OR a team of theirs can create/manage the
 * `objectType` (or, via `parentType`, manage the parent - e.g. managing a
 * `catalog.system` unlocks the incidents surface). Lets team-scoped users reach
 * management pages they hold no global rule for. Resolved via
 * `accessApi.useCanAccessType`.
 */
export interface ManageCapability {
  /**
   * The resource type this surface manages, e.g. `incidentResourceTypes.incident`
   * (`"incident.incident"`). Use an exported `*ResourceTypes` constant, not a raw
   * string.
   */
  objectType: ResourceType;
  /**
   * Optional parent type the resource is created "for" (mirrors the backend
   * contract's `instanceAccess.create.parent.resourceType`), e.g.
   * `catalogResourceTypes.system`. Managing a parent unlocks the child's surface.
   */
  parentType?: ResourceType;
}

/**
 * Sidebar navigation metadata. A route opts into the left sidebar by setting
 * `nav` on its registration; routes without `nav` are reachable (deep links,
 * detail pages) but are not listed in the sidebar.
 */
export interface NavEntry {
  /** Sidebar section heading, e.g. "Workspace" / "Reliability" / "Configuration". */
  group: string;
  /** Icon component for the entry (lucide-react icons satisfy this shape). */
  icon: React.ComponentType<{ className?: string }>;
  /** Sidebar label; defaults to the route's `title`. */
  label?: string;
  /** Sort order within the group (lower first; defaults to 0). */
  order?: number;
  /**
   * Access rule gating sidebar VISIBILITY. Defaults to the route's `accessRule`.
   * Override to surface the entry on a broader rule than the page requires
   * (e.g. show on `read` while the page itself needs `manage`).
   */
  accessRule?: AccessRule;
  /**
   * Team-capability gate for sidebar visibility. Defaults to the route's
   * `manageCapability`. When present, the entry is shown if `accessRule` is
   * satisfied OR the user can create/manage the type (or its parent) via a team.
   */
  manageCapability?: ManageCapability;
  /**
   * Dynamic visibility predicate, evaluated with the current user's access
   * rules and auth state. Use for entries whose visibility cannot be expressed
   * as a single static `accessRule`:
   *  - the Infrastructure entry, visible only if the user can read at least one
   *    of the tabs contributed by other plugins at runtime;
   *  - per-user entries (e.g. Notification Settings) that require an
   *    authenticated user rather than a specific rule.
   * Evaluated IN ADDITION to `accessRule` (both must pass). Returning `false`
   * hides the entry; a group with no visible entries is not rendered.
   */
  isVisible?: (context: {
    /** The current user's granted access-rule IDs (as `isAccessRuleSatisfied` expects). */
    accessRules: string[];
    isAuthenticated: boolean;
  }) => boolean;
}

/** Fields common to every route, regardless of eager/lazy. */
interface PluginRouteBase {
  /** Route definition from common package */
  route: RouteDefinition;
  /** Page title */
  title?: string;
  /** Access rule required to access this route (use access object from common package) */
  accessRule?: AccessRule;
  /**
   * Team-capability gate. When set, the route guard and sidebar allow the route
   * if the user holds `accessRule` (global RBAC) OR can create/manage the
   * declared type via a team grant (ReBAC). Use on management routes so
   * team-scoped users can reach the surfaces they can actually use. The sidebar
   * inherits this for the nav entry unless `nav.manageCapability` overrides it.
   */
  manageCapability?: ManageCapability;
  /** Optional sidebar navigation entry for this route. */
  nav?: NavEntry;
  /**
   * Render this route WITHOUT the app chrome (no header, sidebar, ambient
   * background, command palette). Use for public/standalone surfaces — e.g. a
   * published status page — that must not show the authenticated admin UI. The
   * route still lives inside the API/session providers, so it can call the API.
   */
  standalone?: boolean;
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

  /**
   * The plugin's OWN signal definitions that carry a `resourceKey`, registered
   * so the auto-invalidator can recover the extractor from a received signal's
   * id and scope invalidation to the matching resource instead of the whole
   * plugin cache. Only signals with a `resourceKey` benefit from being listed;
   * a signal without one keeps the default blanket-plugin invalidation whether
   * listed or not. Same-plugin auto-invalidation still works for unlisted
   * signals - listing only unlocks the narrower resource-scoped path.
   */
  signals?: Signal<unknown>[];
}

export function createFrontendPlugin(plugin: FrontendPlugin): FrontendPlugin {
  return plugin;
}
