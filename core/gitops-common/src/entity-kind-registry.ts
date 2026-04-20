import { z } from "zod";
import type { EntityEnvelope } from "./entity-envelope";

/**
 * Context passed to reconcile/delete functions.
 * Extended by gitops-backend with concrete service references.
 */
export interface ReconcileContext {
  /** Logger scoped to this reconciliation */
  logger: {
    debug: (msg: string) => void;
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
}

/**
 * Definition for registering a new entity kind.
 * The owning plugin provides the base spec schema and reconciliation logic.
 */
export interface EntityKindDefinition<TSpec = unknown> {
  /** The API version this kind belongs to (e.g., "checkstack.io/v1alpha1"). */
  apiVersion: string;

  /** The kind name (e.g., "System", "Healthcheck"). Must be unique per apiVersion. */
  kind: string;

  /** Zod schema for validating the `spec` section of descriptors of this kind. */
  specSchema: z.ZodType<TSpec>;

  /**
   * Called when an entity of this kind is discovered or updated via GitOps.
   * The entity's spec is fully validated and all secretRef values are resolved.
   *
   * Must return the plugin-specific entity ID (e.g., the catalog system UUID).
   * The reconciler engine stores this in provenance for generic frontend lookups.
   */
  reconcile: (params: {
    entity: EntityEnvelope & { spec: TSpec };
    /** The plugin-specific entity ID from a previous reconcile, if this entity was reconciled before. */
    existingEntityId?: string;
    context: ReconcileContext;
  }) => Promise<{ entityId: string }>;

  /**
   * Called when an entity of this kind is removed from git (deletion policy: "auto")
   * or when an orphan is manually confirmed for deletion.
   */
  delete?: (params: {
    entityName: string;
    /** The plugin-specific entity ID from provenance, if available. */
    entityId?: string;
    context: ReconcileContext;
  }) => Promise<void>;
}

/**
 * Definition for extending an existing entity kind's spec.
 * The extending plugin adds namespaced fields to another kind's spec schema.
 */
export interface EntityKindExtensionDefinition<TExtensionSpec = unknown> {
  /** The API version of the kind being extended. */
  apiVersion: string;

  /** The kind being extended (e.g., "System"). */
  kind: string;

  /**
   * Namespace for this extension's spec fields.
   * The extension's spec is placed under `spec.<namespace>` in the descriptor.
   * Must be unique per kind. Convention: use your plugin ID (e.g., "healthcheck").
   */
  namespace: string;

  /** Zod schema for validating the extension's spec fields. Should be `.optional()`. */
  specSchema: z.ZodType<TExtensionSpec>;

  /**
   * Called when an entity with this extension's namespace is reconciled.
   * Only called if the extension's namespace is present in the spec.
   */
  reconcile: (params: {
    entity: EntityEnvelope;
    extensionSpec: TExtensionSpec;
    context: ReconcileContext;
  }) => Promise<void>;
}

/**
 * The registry interface exposed via the Extension Point.
 * Plugins call these methods during their `register()` phase.
 */
export interface EntityKindRegistry {
  /** Register a new entity kind (e.g., catalog registers "System"). */
  registerKind<TSpec>(definition: EntityKindDefinition<TSpec>): void;

  /** Extend an existing kind's spec (e.g., healthcheck extends "System"). */
  registerKindExtension<TExtensionSpec>(
    definition: EntityKindExtensionDefinition<TExtensionSpec>,
  ): void;
}
