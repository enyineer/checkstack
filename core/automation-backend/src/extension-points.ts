import {
  createExtensionPoint,
  createServiceRef,
} from "@checkstack/backend-api";
import type { PluginMetadata } from "@checkstack/common";
import type { AutomationTemplateInput } from "@checkstack/automation-common";
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

/**
 * Extension point for registering curated **example-automation templates** —
 * ready-to-use starting points an operator can pick when creating a new
 * automation. Core and external plugins both contribute here; a contributor
 * supplies an unqualified `id` (and no `ownerPluginId`), both of which are
 * stamped from the registering plugin's metadata.
 *
 * Each template's `definition` references concrete action / trigger / artifact
 * ids, so the backend validates every registered template against the LIVE
 * registries at startup (see `validate-templates.ts`): a template whose
 * dependencies are not installed is quietly skipped, while one that references
 * a drifted action/trigger/artifact interface is logged loudly and withheld.
 */
export interface AutomationTemplateExtensionPoint {
  registerTemplate(
    template: AutomationTemplateInput,
    pluginMetadata: PluginMetadata,
  ): void;
}

export const automationTemplateExtensionPoint =
  createExtensionPoint<AutomationTemplateExtensionPoint>(
    "automation.templateExtensionPoint",
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
