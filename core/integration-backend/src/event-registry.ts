import type { PluginMetadata } from "@checkmate-monitor/common";
import { toJsonSchema } from "@checkmate-monitor/backend-api";
import type {
  IntegrationEventDefinition,
  RegisteredIntegrationEvent,
} from "./provider-types";

/**
 * Registry for integration events.
 * Plugins register their hooks here to expose them for external webhook subscriptions.
 */
export interface IntegrationEventRegistry {
  /**
   * Register a hook as an integration event.
   * Called via the extension point during plugin registration.
   */
  register<T>(
    definition: IntegrationEventDefinition<T>,
    pluginMetadata: PluginMetadata
  ): void;

  /** Get all registered events */
  getEvents(): RegisteredIntegrationEvent[];

  /** Get events grouped by category */
  getEventsByCategory(): Map<string, RegisteredIntegrationEvent[]>;

  /** Get a specific event by its fully qualified ID */
  getEvent(eventId: string): RegisteredIntegrationEvent | undefined;

  /** Check if an event is registered */
  hasEvent(eventId: string): boolean;
}

/**
 * Create a new integration event registry instance.
 */
export function createIntegrationEventRegistry(): IntegrationEventRegistry {
  const events = new Map<string, RegisteredIntegrationEvent>();

  return {
    register<T>(
      definition: IntegrationEventDefinition<T>,
      pluginMetadata: PluginMetadata
    ): void {
      // Extract hook ID from the hook reference
      const hookId = definition.hook.id;

      // Create fully qualified event ID
      const eventId = `${pluginMetadata.pluginId}.${hookId}`;

      // Convert Zod schema to JSON Schema for UI preview
      // Uses the platform's toJsonSchema which handles secrets/colors
      const payloadJsonSchema = toJsonSchema(definition.payloadSchema);

      const registered: RegisteredIntegrationEvent<T> = {
        eventId,
        hook: definition.hook,
        ownerPluginId: pluginMetadata.pluginId,
        displayName: definition.displayName,
        description: definition.description,
        category: definition.category ?? "Uncategorized",
        payloadJsonSchema,
        payloadSchema: definition.payloadSchema,
        transformPayload: definition.transformPayload,
      };

      // We cast to RegisteredIntegrationEvent (with unknown) when storing because
      // the Map erases the specific type T anyway. This is type-safe because
      // the transformPayload function will only be called with the correct type.
      events.set(eventId, registered as RegisteredIntegrationEvent);
    },

    getEvents(): RegisteredIntegrationEvent[] {
      return [...events.values()];
    },

    getEventsByCategory(): Map<string, RegisteredIntegrationEvent[]> {
      const byCategory = new Map<string, RegisteredIntegrationEvent[]>();

      for (const event of events.values()) {
        const category = event.category ?? "Uncategorized";
        const existing = byCategory.get(category) ?? [];
        existing.push(event);
        byCategory.set(category, existing);
      }

      return byCategory;
    },

    getEvent(eventId: string): RegisteredIntegrationEvent | undefined {
      return events.get(eventId);
    },

    hasEvent(eventId: string): boolean {
      return events.has(eventId);
    },
  };
}
