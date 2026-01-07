import { describe, it, expect, beforeEach } from "bun:test";
import { z } from "zod";
import {
  createIntegrationEventRegistry,
  type IntegrationEventRegistry,
} from "./event-registry";
import type { IntegrationEventDefinition } from "./provider-types";
import { createHook } from "@checkmate-monitor/backend-api";

/**
 * Unit tests for IntegrationEventRegistry.
 *
 * Tests cover:
 * - Event registration with proper namespacing
 * - Event retrieval by ID and category
 * - JSON Schema generation from Zod
 * - Transform function preservation
 */

// Test plugin metadata
const testPluginMetadata = {
  pluginId: "test-plugin",
  displayName: "Test Plugin",
  description: "A test plugin",
} as const;

// Test hook definitions
const testHook1 = createHook<{ incidentId: string; severity: string }>(
  "incident.created"
);
const testHook2 = createHook<{ systemId: string; status: string }>(
  "system.updated"
);
const testHook3 = createHook<{ maintenanceId: string }>("maintenance.started");

// Test payload schemas
const incidentPayloadSchema = z.object({
  incidentId: z.string(),
  severity: z.string(),
});

const systemPayloadSchema = z.object({
  systemId: z.string(),
  status: z.string(),
});

const maintenancePayloadSchema = z.object({
  maintenanceId: z.string(),
});

describe("IntegrationEventRegistry", () => {
  let registry: IntegrationEventRegistry;

  beforeEach(() => {
    registry = createIntegrationEventRegistry();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Event Registration
  // ─────────────────────────────────────────────────────────────────────────

  describe("register", () => {
    it("registers an event with a fully qualified ID", () => {
      const definition: IntegrationEventDefinition<{
        incidentId: string;
        severity: string;
      }> = {
        hook: testHook1,
        displayName: "Incident Created",
        description: "Fired when an incident is created",
        category: "Incidents",
        payloadSchema: incidentPayloadSchema,
      };

      registry.register(definition, testPluginMetadata);

      expect(registry.hasEvent("test-plugin.incident.created")).toBe(true);
    });

    it("generates correct fully qualified event ID", () => {
      registry.register(
        {
          hook: testHook1,
          displayName: "Incident Created",
          payloadSchema: incidentPayloadSchema,
        },
        testPluginMetadata
      );

      const event = registry.getEvent("test-plugin.incident.created");
      expect(event?.eventId).toBe("test-plugin.incident.created");
      expect(event?.ownerPluginId).toBe("test-plugin");
    });

    it("preserves display metadata", () => {
      registry.register(
        {
          hook: testHook1,
          displayName: "Incident Created",
          description: "Fired when an incident is created",
          category: "Incidents",
          payloadSchema: incidentPayloadSchema,
        },
        testPluginMetadata
      );

      const event = registry.getEvent("test-plugin.incident.created");
      expect(event?.displayName).toBe("Incident Created");
      expect(event?.description).toBe("Fired when an incident is created");
      expect(event?.category).toBe("Incidents");
    });

    it("defaults category to Uncategorized", () => {
      registry.register(
        {
          hook: testHook1,
          displayName: "Incident Created",
          payloadSchema: incidentPayloadSchema,
        },
        testPluginMetadata
      );

      const event = registry.getEvent("test-plugin.incident.created");
      expect(event?.category).toBe("Uncategorized");
    });

    it("generates JSON Schema from Zod schema", () => {
      registry.register(
        {
          hook: testHook1,
          displayName: "Incident Created",
          payloadSchema: incidentPayloadSchema,
        },
        testPluginMetadata
      );

      const event = registry.getEvent("test-plugin.incident.created");
      expect(event?.payloadJsonSchema).toBeDefined();
      expect(typeof event?.payloadJsonSchema).toBe("object");

      // JSON Schema should have properties for the payload fields
      const schema = event?.payloadJsonSchema as Record<string, unknown>;
      expect(schema.type).toBe("object");
    });

    it("preserves transform function", () => {
      const transform = (payload: {
        incidentId: string;
        severity: string;
      }) => ({
        id: payload.incidentId,
        level: payload.severity.toUpperCase(),
      });

      registry.register(
        {
          hook: testHook1,
          displayName: "Incident Created",
          payloadSchema: incidentPayloadSchema,
          transformPayload: transform,
        },
        testPluginMetadata
      );

      const event = registry.getEvent("test-plugin.incident.created");
      expect(event?.transformPayload).toBeDefined();

      const transformed = event?.transformPayload?.({
        incidentId: "inc-123",
        severity: "critical",
      });
      expect(transformed).toEqual({ id: "inc-123", level: "CRITICAL" });
    });

    it("preserves hook reference", () => {
      registry.register(
        {
          hook: testHook1,
          displayName: "Incident Created",
          payloadSchema: incidentPayloadSchema,
        },
        testPluginMetadata
      );

      const event = registry.getEvent("test-plugin.incident.created");
      expect(event?.hook.id).toBe("incident.created");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Event Retrieval
  // ─────────────────────────────────────────────────────────────────────────

  describe("getEvents", () => {
    it("returns empty array when no events registered", () => {
      expect(registry.getEvents()).toEqual([]);
    });

    it("returns all registered events", () => {
      registry.register(
        {
          hook: testHook1,
          displayName: "Incident Created",
          payloadSchema: incidentPayloadSchema,
        },
        testPluginMetadata
      );
      registry.register(
        {
          hook: testHook2,
          displayName: "System Updated",
          payloadSchema: systemPayloadSchema,
        },
        testPluginMetadata
      );

      const events = registry.getEvents();
      expect(events.length).toBe(2);
      expect(events.map((e) => e.displayName).sort()).toEqual([
        "Incident Created",
        "System Updated",
      ]);
    });
  });

  describe("getEvent", () => {
    it("returns undefined for non-existent event", () => {
      expect(registry.getEvent("non-existent.event")).toBeUndefined();
    });

    it("returns event by fully qualified ID", () => {
      registry.register(
        {
          hook: testHook1,
          displayName: "Incident Created",
          payloadSchema: incidentPayloadSchema,
        },
        testPluginMetadata
      );

      const event = registry.getEvent("test-plugin.incident.created");
      expect(event?.displayName).toBe("Incident Created");
    });
  });

  describe("hasEvent", () => {
    it("returns false for non-existent event", () => {
      expect(registry.hasEvent("non-existent.event")).toBe(false);
    });

    it("returns true for registered event", () => {
      registry.register(
        {
          hook: testHook1,
          displayName: "Incident Created",
          payloadSchema: incidentPayloadSchema,
        },
        testPluginMetadata
      );

      expect(registry.hasEvent("test-plugin.incident.created")).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Category Grouping
  // ─────────────────────────────────────────────────────────────────────────

  describe("getEventsByCategory", () => {
    it("returns empty map when no events registered", () => {
      const byCategory = registry.getEventsByCategory();
      expect(byCategory.size).toBe(0);
    });

    it("groups events by category", () => {
      registry.register(
        {
          hook: testHook1,
          displayName: "Incident Created",
          category: "Incidents",
          payloadSchema: incidentPayloadSchema,
        },
        testPluginMetadata
      );
      registry.register(
        {
          hook: testHook2,
          displayName: "System Updated",
          category: "Catalog",
          payloadSchema: systemPayloadSchema,
        },
        testPluginMetadata
      );
      registry.register(
        {
          hook: testHook3,
          displayName: "Maintenance Started",
          category: "Incidents",
          payloadSchema: maintenancePayloadSchema,
        },
        testPluginMetadata
      );

      const byCategory = registry.getEventsByCategory();

      expect(byCategory.size).toBe(2);
      expect(byCategory.get("Incidents")?.length).toBe(2);
      expect(byCategory.get("Catalog")?.length).toBe(1);
    });

    it("groups uncategorized events together", () => {
      registry.register(
        {
          hook: testHook1,
          displayName: "Event 1",
          payloadSchema: incidentPayloadSchema,
        },
        testPluginMetadata
      );
      registry.register(
        {
          hook: testHook2,
          displayName: "Event 2",
          payloadSchema: systemPayloadSchema,
        },
        testPluginMetadata
      );

      const byCategory = registry.getEventsByCategory();
      expect(byCategory.get("Uncategorized")?.length).toBe(2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Multi-Plugin Registration
  // ─────────────────────────────────────────────────────────────────────────

  describe("multi-plugin registration", () => {
    it("handles events from multiple plugins", () => {
      const plugin1 = { pluginId: "plugin-1" } as const;
      const plugin2 = { pluginId: "plugin-2" } as const;

      registry.register(
        {
          hook: testHook1,
          displayName: "Plugin 1 Event",
          payloadSchema: incidentPayloadSchema,
        },
        plugin1
      );
      registry.register(
        {
          hook: testHook1,
          displayName: "Plugin 2 Event",
          payloadSchema: incidentPayloadSchema,
        },
        plugin2
      );

      expect(registry.hasEvent("plugin-1.incident.created")).toBe(true);
      expect(registry.hasEvent("plugin-2.incident.created")).toBe(true);

      const events = registry.getEvents();
      expect(events.length).toBe(2);
    });

    it("correctly namespaces events by plugin", () => {
      const plugin1 = { pluginId: "incident" } as const;
      const plugin2 = { pluginId: "maintenance" } as const;

      registry.register(
        {
          hook: createHook("created"),
          displayName: "Incident Created",
          payloadSchema: incidentPayloadSchema,
        },
        plugin1
      );
      registry.register(
        {
          hook: createHook("created"),
          displayName: "Maintenance Created",
          payloadSchema: maintenancePayloadSchema,
        },
        plugin2
      );

      expect(registry.getEvent("incident.created")?.displayName).toBe(
        "Incident Created"
      );
      expect(registry.getEvent("maintenance.created")?.displayName).toBe(
        "Maintenance Created"
      );
    });
  });
});
