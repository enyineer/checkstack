import { describe, it, expect } from "bun:test";
import { z } from "zod";
import { createEntityKindRegistry } from "./kind-registry";
import { CHECKSTACK_API_VERSION } from "@checkstack/gitops-common";

describe("EntityKindRegistry", () => {
  it("registers a kind and retrieves it", () => {
    const registry = createEntityKindRegistry();
    const specSchema = z.object({ description: z.string().optional() });

    registry.registerKind({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "System",
      specSchema,
      reconcile: async () => ({ entityId: "test-id" }),
    });

    const kind = registry.getKind({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "System",
    });
    expect(kind).toBeDefined();
    expect(kind?.kind).toBe("System");
  });

  it("throws on duplicate kind registration", () => {
    const registry = createEntityKindRegistry();
    const def = {
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "System",
      specSchema: z.object({}),
      reconcile: async () => ({ entityId: "test-id" }),
    };

    registry.registerKind(def);
    expect(() => registry.registerKind(def)).toThrow(/already registered/);
  });

  it("registers a kind extension", () => {
    const registry = createEntityKindRegistry();

    registry.registerKind({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "System",
      specSchema: z.object({ description: z.string().optional() }),
      reconcile: async () => ({ entityId: "test-id" }),
    });

    registry.registerKindExtension({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "System",
      namespace: "healthcheck",
      specSchema: z.array(z.object({ ref: z.string() })).optional(),
      reconcile: async () => {},
    });

    const extensions = registry.getExtensions({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "System",
    });
    expect(extensions).toHaveLength(1);
    expect(extensions[0].namespace).toBe("healthcheck");
  });

  it("throws on duplicate extension namespace", () => {
    const registry = createEntityKindRegistry();

    registry.registerKind({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "System",
      specSchema: z.object({}),
      reconcile: async () => ({ entityId: "test-id" }),
    });

    const extDef = {
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "System",
      namespace: "healthcheck",
      specSchema: z.object({}).optional(),
      reconcile: async () => {},
    };

    registry.registerKindExtension(extDef);
    expect(() => registry.registerKindExtension(extDef)).toThrow(
      /already registered/,
    );
  });

  it("allows registering extensions before the kind itself", () => {
    const registry = createEntityKindRegistry();

    // Extension first
    registry.registerKindExtension({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "System",
      namespace: "healthcheck",
      specSchema: z.array(z.object({ ref: z.string() })).optional(),
      reconcile: async () => {},
    });

    // Kind after
    registry.registerKind({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "System",
      specSchema: z.object({ description: z.string().optional() }),
      reconcile: async () => ({ entityId: "test-id" }),
    });

    const kind = registry.getKind({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "System",
    });
    expect(kind).toBeDefined();

    const extensions = registry.getExtensions({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "System",
    });
    expect(extensions).toHaveLength(1);
  });

  it("builds a merged spec schema with extensions", () => {
    const registry = createEntityKindRegistry();

    registry.registerKind({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "System",
      specSchema: z.object({ description: z.string().optional() }),
      reconcile: async () => ({ entityId: "test-id" }),
    });

    registry.registerKindExtension({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "System",
      namespace: "healthcheck",
      specSchema: z.array(z.object({ ref: z.string() })).optional(),
      reconcile: async () => {},
    });

    const merged = registry.getMergedSpecSchema({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "System",
    });

    // Should validate base spec fields
    const result1 = merged.safeParse({ description: "test" });
    expect(result1.success).toBe(true);

    // Should validate extension namespace fields
    const result2 = merged.safeParse({
      description: "test",
      healthcheck: [{ ref: "my-check" }],
    });
    expect(result2.success).toBe(true);

    // Extension namespace should be optional
    const result3 = merged.safeParse({});
    expect(result3.success).toBe(true);
  });

  it("lists all registered kinds", () => {
    const registry = createEntityKindRegistry();

    registry.registerKind({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "System",
      specSchema: z.object({}),
      reconcile: async () => ({ entityId: "test-id" }),
    });

    registry.registerKind({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "Healthcheck",
      specSchema: z.object({}),
      reconcile: async () => ({ entityId: "test-id" }),
    });

    expect(registry.getKinds()).toHaveLength(2);
  });

  it("returns empty array for extensions of unregistered kind", () => {
    const registry = createEntityKindRegistry();
    const extensions = registry.getExtensions({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "Unknown",
    });
    expect(extensions).toHaveLength(0);
  });

  describe("describeKinds", () => {
    it("returns JSON Schema representations of registered kinds", () => {
      const registry = createEntityKindRegistry();

      registry.registerKind({
        apiVersion: CHECKSTACK_API_VERSION,
        kind: "System",
        specSchema: z.object({
          description: z.string().optional(),
          tier: z.enum(["critical", "standard"]),
        }),
        reconcile: async () => ({ entityId: "test-id" }),
      });

      const described = registry.describeKinds();
      expect(described).toHaveLength(1);

      const sys = described[0];
      expect(sys.apiVersion).toBe(CHECKSTACK_API_VERSION);
      expect(sys.kind).toBe("System");
      expect(sys.specSchema).toBeDefined();
      expect(sys.extensions).toHaveLength(0);

      // Verify JSON Schema structure
      const schema = sys.specSchema as Record<string, unknown>;
      expect(schema.type).toBe("object");
      const props = schema.properties as Record<string, Record<string, unknown>>;
      expect(props.description).toBeDefined();
      expect(props.tier).toBeDefined();
    });

    it("includes extensions in the description", () => {
      const registry = createEntityKindRegistry();

      registry.registerKind({
        apiVersion: CHECKSTACK_API_VERSION,
        kind: "System",
        specSchema: z.object({ description: z.string().optional() }),
        reconcile: async () => ({ entityId: "test-id" }),
      });

      registry.registerKindExtension({
        apiVersion: CHECKSTACK_API_VERSION,
        kind: "System",
        namespace: "healthcheck",
        specSchema: z.array(z.object({ ref: z.string() })).optional(),
        reconcile: async () => {},
      });

      const described = registry.describeKinds();
      expect(described).toHaveLength(1);
      expect(described[0].extensions).toHaveLength(1);
      expect(described[0].extensions[0].namespace).toBe("healthcheck");
      expect(described[0].extensions[0].specSchema).toBeDefined();
    });

    it("skips kinds without a base definition", () => {
      const registry = createEntityKindRegistry();

      // Only register an extension — no base kind
      registry.registerKindExtension({
        apiVersion: CHECKSTACK_API_VERSION,
        kind: "Orphaned",
        namespace: "test",
        specSchema: z.object({}).optional(),
        reconcile: async () => {},
      });

      const described = registry.describeKinds();
      expect(described).toHaveLength(0);
    });
  });
});
