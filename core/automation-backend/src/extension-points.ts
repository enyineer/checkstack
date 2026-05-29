import {
  createExtensionPoint,
  createServiceRef,
} from "@checkstack/backend-api";
import type { PluginMetadata } from "@checkstack/common";
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
