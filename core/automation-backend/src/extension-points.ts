import {
  createExtensionPoint,
  createServiceRef,
} from "@checkstack/backend-api";
import type { PluginMetadata } from "@checkstack/common";
import type { Filter } from "@checkstack/template-engine";
import type {
  ActionDefinition,
  ArtifactTypeDefinition,
  TriggerDefinition,
} from "./action-types";
import type { ActionRegistry } from "./action-registry";
import type { ArtifactTypeRegistry } from "./artifact-type-registry";
import type { TriggerRegistry } from "./trigger-registry";
import type { ArtifactStore } from "./artifact-store";
import type { EntityTx, KeyedStore } from "./entity";

/**
 * Extension point for registering automation triggers — entry points that
 * fire automations when their underlying event arrives.
 */
export interface AutomationTriggerExtensionPoint {
  registerTrigger<TPayload, TConfig = void>(
    definition: TriggerDefinition<TPayload, TConfig>,
    pluginMetadata: PluginMetadata,
  ): void;
}

export const automationTriggerExtensionPoint =
  createExtensionPoint<AutomationTriggerExtensionPoint>(
    "automation.triggerExtensionPoint",
  );

/**
 * Extension point for registering automation actions — callable work the
 * automation editor exposes to operators.
 */
export interface AutomationActionExtensionPoint {
  registerAction<TConfig, TArtifact = unknown>(
    definition: ActionDefinition<TConfig, TArtifact>,
    pluginMetadata: PluginMetadata,
  ): void;
}

export const automationActionExtensionPoint =
  createExtensionPoint<AutomationActionExtensionPoint>(
    "automation.actionExtensionPoint",
  );

/**
 * Extension point for registering artifact types — typed payloads
 * produced and consumed by actions.
 */
export interface AutomationArtifactTypeExtensionPoint {
  registerArtifactType<T>(
    definition: ArtifactTypeDefinition<T>,
    pluginMetadata: PluginMetadata,
  ): void;
}

export const automationArtifactTypeExtensionPoint =
  createExtensionPoint<AutomationArtifactTypeExtensionPoint>(
    "automation.artifactTypeExtensionPoint",
  );

/**
 * A plugin-contributed template filter. Filters MUST be pure and
 * synchronous (no I/O, no async, no DB) — the template engine evaluates
 * them inline during condition/value rendering. `description` and
 * `signature` feed the editor's autocomplete catalogue.
 */
export interface FilterDefinition {
  /** Pipe name, e.g. `older_than`. Used as `{{ value | older_than(...) }}`. */
  name: string;
  /** The pure transform. First arg is the piped value. */
  filter: Filter;
  /** One-line description for the autocomplete catalogue. */
  description?: string;
  /** Human-readable call signature, e.g. `older_than(thresholdMs)`. */
  signature?: string;
}

/**
 * Extension point for registering pure template filters. Lets plugins
 * contribute domain-specific transforms (e.g. a duration or unit helper)
 * without forking the template engine's default registry.
 */
export interface AutomationFilterExtensionPoint {
  registerFilter(
    definition: FilterDefinition,
    pluginMetadata: PluginMetadata,
  ): void;
}

export const automationFilterExtensionPoint =
  createExtensionPoint<AutomationFilterExtensionPoint>(
    "automation.filterExtensionPoint",
  );

// ─── Service refs ─────────────────────────────────────────────────────────

/**
 * Read-only view of the trigger / action / artifact-type registries.
 * Other plugins (and the frontend RPC) can inject this to introspect what
 * the automation platform offers.
 */
export interface AutomationRegistries {
  readonly triggers: TriggerRegistry;
  readonly actions: ActionRegistry;
  readonly artifactTypes: ArtifactTypeRegistry;
}

export const automationRegistriesRef = createServiceRef<AutomationRegistries>(
  "automation.registries",
);

/**
 * Service ref for the artifact store. Cross-plugin code (e.g. an action
 * in `integration-jira-backend` that wants to look up a prior issue
 * artifact) injects this to query / persist artifacts.
 */
export const automationArtifactStoreRef = createServiceRef<ArtifactStore>(
  "automation.artifactStore",
);

/**
 * Cross-plugin access to the framework keyed store (`entity_state`) for a
 * HOMELESS reactive entity kind (Model B, reactive automation engine §15.1).
 *
 * `entity_state` lives in automation-backend's schema, behind automation-
 * backend's schema-scoped DB. A plugin whose entity kind has no natural
 * current-state table of its own (e.g. healthcheck's computed per-system
 * `health` aggregate) cannot reach `entity_state` through its OWN scoped DB,
 * so this ref hands out a {@link KeyedStore} bound to automation-backend's
 * DB plus a transaction runner over the same DB. The plugin wires:
 *
 * ```ts
 * const keyed = svc.keyedStoreFor<HealthEntityState>("health");
 * const handle = defineEntity({ kind: "health", state, read: keyed.readMany });
 * // ...inside a mutation, where `handle.mutate`'s apply takes NO framework tx:
 * await handle.mutate({
 *   id: systemId,
 *   apply: () =>
 *     svc.runInTransaction((tx) => keyed.write({ tx, id: systemId, state })),
 * });
 * ```
 *
 * The keyed write + the framework transition append run in SEPARATE
 * transactions (the documented Model B post-commit boundary), but both target
 * the same physical schema, so the homeless kind still gets durable platform
 * history in `entity_transitions`.
 */
export interface EntityKeyedStoreService {
  /** A keyed store over `entity_state` for `kind`, bound to automation's DB. */
  keyedStoreFor<TState extends Record<string, unknown>>(
    kind: string,
  ): KeyedStore<TState>;
  /**
   * Run `fn` inside ONE transaction on automation-backend's DB, passing the
   * transaction handle the keyed store's `write` / `remove` need. Use this to
   * drive a keyed-store write from a plugin-backed `handle.mutate` apply
   * (which receives no framework tx).
   */
  runInTransaction<R>(fn: (tx: EntityTx) => Promise<R>): Promise<R>;
}

/**
 * Service ref for the framework keyed store (`entity_state`). A plugin with a
 * homeless reactive entity kind injects this to read/write its current state
 * in `entity_state` while keeping the kind reactive via `handle.mutate`.
 */
export const entityKeyedStoreServiceRef =
  createServiceRef<EntityKeyedStoreService>("automation.entityKeyedStore");
