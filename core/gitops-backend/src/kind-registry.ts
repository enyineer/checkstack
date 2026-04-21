import { z } from "zod";
import { toJsonSchema } from "@checkstack/backend-api";
import type {
  EntityKindDefinition,
  EntityKindExtensionDefinition,
  EntityKindRegistry,
} from "@checkstack/gitops-common";

/** Internal storage for a registered kind with its extensions. */
interface RegisteredKind {
  definition: EntityKindDefinition<unknown> | undefined;
  extensions: Map<string, EntityKindExtensionDefinition<unknown>>;
}

/** Composite key for looking up kinds by apiVersion + kind. */
function kindKey(params: { apiVersion: string; kind: string }): string {
  return `${params.apiVersion}::${params.kind}`;
}

/**
 * Creates a new Entity Kind Registry.
 * This is the backing implementation for the `entityKindExtensionPoint`.
 */
export function createEntityKindRegistry() {
  const kinds = new Map<string, RegisteredKind>();

  const registry: EntityKindRegistry & {
    /** Get a registered kind definition. */
    getKind: (params: {
      apiVersion: string;
      kind: string;
    }) => EntityKindDefinition<unknown> | undefined;
    /** Get all extensions for a kind. */
    getExtensions: (params: {
      apiVersion: string;
      kind: string;
    }) => EntityKindExtensionDefinition<unknown>[];
    /** Get the merged spec schema (base + all extensions). */
    getMergedSpecSchema: (params: {
      apiVersion: string;
      kind: string;
    }) => z.ZodType<unknown>;
    /** List all registered kinds. */
    getKinds: () => EntityKindDefinition<unknown>[];
    /** Describe all registered kinds with JSON Schema representations. */
    describeKinds: () => Array<{
      apiVersion: string;
      kind: string;
      specSchema: Record<string, unknown>;
      extensions: Array<{
        namespace: string;
        specSchema: Record<string, unknown>;
      }>;
    }>;
  } = {
    registerKind<TSpec>(definition: EntityKindDefinition<TSpec>) {
      const key = kindKey(definition);
      const existing = kinds.get(key);

      if (existing?.definition) {
        throw new Error(
          `Entity kind "${definition.kind}" (${definition.apiVersion}) is already registered`,
        );
      }

      if (existing) {
        // Extensions were registered before the kind — attach the definition
        existing.definition = definition as EntityKindDefinition<unknown>;
      } else {
        kinds.set(key, {
          definition: definition as EntityKindDefinition<unknown>,
          extensions: new Map(),
        });
      }
    },

    registerKindExtension<TExtensionSpec>(
      definition: EntityKindExtensionDefinition<TExtensionSpec>,
    ) {
      const key = kindKey(definition);
      const registered = kinds.get(key);

      if (!registered) {
        // Allow registering extensions before the kind itself.
        // The kind might be registered by a plugin that loads later.
        kinds.set(key, {
          definition: undefined,
          extensions: new Map([
            [
              definition.namespace,
              definition as EntityKindExtensionDefinition<unknown>,
            ],
          ]),
        });
        return;
      }

      if (registered.extensions.has(definition.namespace)) {
        throw new Error(
          `Extension namespace "${definition.namespace}" for kind "${definition.kind}" (${definition.apiVersion}) is already registered`,
        );
      }

      registered.extensions.set(
        definition.namespace,
        definition as EntityKindExtensionDefinition<unknown>,
      );
    },

    getKind(params) {
      return kinds.get(kindKey(params))?.definition;
    },

    getExtensions(params) {
      const registered = kinds.get(kindKey(params));
      if (!registered) return [];
      return [...registered.extensions.values()];
    },

    getMergedSpecSchema(params) {
      const registered = kinds.get(kindKey(params));
      if (!registered?.definition) {
        throw new Error(
          `Cannot build merged schema: kind "${params.kind}" (${params.apiVersion}) has no base definition`,
        );
      }

      // Start with the base spec schema
      let merged = registered.definition
        .specSchema as z.ZodObject<z.ZodRawShape>;

      // Merge each extension's schema under its namespace key
      for (const [namespace, ext] of registered.extensions) {
        merged = merged.extend({
          [namespace]: ext.specSchema,
        }) as z.ZodObject<z.ZodRawShape>;
      }

      return merged;
    },

    getKinds() {
      return [...kinds.values()]
        .map((r) => r.definition)
        .filter((d): d is EntityKindDefinition<unknown> => d !== undefined);
    },

    describeKinds() {
      const result: Array<{
        apiVersion: string;
        kind: string;
        specSchema: Record<string, unknown>;
        extensions: Array<{
          namespace: string;
          specSchema: Record<string, unknown>;
        }>;
      }> = [];

      for (const registered of kinds.values()) {
        if (!registered.definition) continue;

        const def = registered.definition;
        const baseSchema = toJsonSchema(
          def.specSchema as z.ZodTypeAny,
        );

        const extensions = [...registered.extensions.entries()].map(
          ([namespace, ext]) => ({
            namespace,
            specSchema: toJsonSchema(ext.specSchema as z.ZodTypeAny),
          }),
        );

        result.push({
          apiVersion: def.apiVersion,
          kind: def.kind,
          specSchema: baseSchema,
          extensions,
        });
      }

      return result;
    },
  };

  return registry;
}

export type InternalEntityKindRegistry = ReturnType<
  typeof createEntityKindRegistry
>;
