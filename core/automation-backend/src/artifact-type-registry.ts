import type { PluginMetadata } from "@checkstack/common";
import { toJsonSchema } from "@checkstack/backend-api";
import type {
  ArtifactTypeDefinition,
  RegisteredArtifactType,
} from "./action-types";

/**
 * Registry for artifact types — typed payloads that actions produce and
 * consume. Used by the dispatch engine to validate artifact `data` against
 * the declaring plugin's schema, and by the editor to surface field-aware
 * intellisense for `artifacts.<type>.*` references.
 */
export interface ArtifactTypeRegistry {
  register<T>(
    definition: ArtifactTypeDefinition<T>,
    pluginMetadata: PluginMetadata,
  ): void;

  getArtifactTypes(): RegisteredArtifactType[];
  getArtifactType(qualifiedId: string): RegisteredArtifactType | undefined;
  hasArtifactType(qualifiedId: string): boolean;
}

export function createArtifactTypeRegistry(): ArtifactTypeRegistry {
  const types = new Map<string, RegisteredArtifactType>();

  return {
    register<T>(
      definition: ArtifactTypeDefinition<T>,
      pluginMetadata: PluginMetadata,
    ): void {
      const qualifiedId = `${pluginMetadata.pluginId}.${definition.id}`;
      if (types.has(qualifiedId)) {
        throw new Error(
          `Artifact type ${qualifiedId} already registered — likely a duplicate registration in ${pluginMetadata.pluginId}.`,
        );
      }

      const jsonSchema = toJsonSchema(definition.schema);

      const registered: RegisteredArtifactType<T> = {
        ...definition,
        qualifiedId,
        ownerPluginId: pluginMetadata.pluginId,
        jsonSchema,
      };

      types.set(qualifiedId, registered as RegisteredArtifactType);
    },

    getArtifactTypes(): RegisteredArtifactType[] {
      return [...types.values()];
    },

    getArtifactType(qualifiedId: string): RegisteredArtifactType | undefined {
      return types.get(qualifiedId);
    },

    hasArtifactType(qualifiedId: string): boolean {
      return types.has(qualifiedId);
    },
  };
}
