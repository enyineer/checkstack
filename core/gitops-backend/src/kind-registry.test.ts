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
      expect(sys.metadataSchema).toBeDefined();
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

  describe("registerSpecSchemaDocumentation", () => {
    it("allows registering documentation for different field paths and multiple entries per path", () => {
      const registry = createEntityKindRegistry();

      registry.registerKind({
        apiVersion: CHECKSTACK_API_VERSION,
        kind: "Healthcheck",
        specSchema: z.object({ config: z.unknown(), collectors: z.array(z.unknown()) }),
        reconcile: async () => ({ entityId: "test-id" }),
      });

      // Register two strategies for the 'config' field
      registry.registerSpecSchemaDocumentation({
        apiVersion: CHECKSTACK_API_VERSION,
        kind: "Healthcheck",
        fieldPath: "config",
        variantId: "http-strat",
        label: "HTTP Strategy",
        description: "Configure HTTP health check",
        schema: z.object({ url: z.string() }),
      });

      registry.registerSpecSchemaDocumentation({
        apiVersion: CHECKSTACK_API_VERSION,
        kind: "Healthcheck",
        fieldPath: "config",
        variantId: "dns-strat",
        label: "DNS Strategy",
        schema: z.object({ hostname: z.string() }), // no description
      });

      // Register a collector for 'collectors[].config'
      registry.registerSpecSchemaDocumentation({
        apiVersion: CHECKSTACK_API_VERSION,
        kind: "Healthcheck",
        fieldPath: "collectors[].config",
        label: "Ping Collector",
        description: "Ping something",
        schema: z.object({ count: z.number() }),
        conditions: [{
          fieldPath: "config",
          variantIds: ["http-strat", "dns-strat"],
        }],
      });

      const described = registry.describeKinds();
      expect(described).toHaveLength(1);
      
      const docs = described[0].specSchemaDocumentation;
      expect(docs).toHaveLength(3);

      const configDocs = docs.filter(d => d.fieldPath === "config");
      expect(configDocs).toHaveLength(2);
      expect(configDocs[0].label).toBe("HTTP Strategy");
      expect(configDocs[0].variantId).toBe("http-strat");
      expect(configDocs[0].description).toBe("Configure HTTP health check");
      expect(configDocs[1].label).toBe("DNS Strategy");
      expect(configDocs[1].variantId).toBe("dns-strat");
      expect(configDocs[1].description).toBeUndefined();

      const collectorDocs = docs.filter(d => d.fieldPath === "collectors[].config");
      expect(collectorDocs).toHaveLength(1);
      expect(collectorDocs[0].label).toBe("Ping Collector");
      expect(collectorDocs[0].conditions).toBeDefined();
      expect(collectorDocs[0].conditions?.[0].variantIds).toEqual(["http-strat", "dns-strat"]);
    });

    it("allows registering docs before the kind itself is registered", () => {
      const registry = createEntityKindRegistry();

      registry.registerSpecSchemaDocumentation({
        apiVersion: CHECKSTACK_API_VERSION,
        kind: "Healthcheck",
        fieldPath: "config",
        label: "HTTP Strategy",
        schema: z.object({ url: z.string() }),
      });

      // Base kind is missing, so describeKinds should skip it
      expect(registry.describeKinds()).toHaveLength(0);

      registry.registerKind({
        apiVersion: CHECKSTACK_API_VERSION,
        kind: "Healthcheck",
        specSchema: z.object({ config: z.unknown() }),
        reconcile: async () => ({ entityId: "test-id" }),
      });

      // Now it should be included
      const described = registry.describeKinds();
      expect(described).toHaveLength(1);
      expect(described[0].specSchemaDocumentation).toHaveLength(1);
    });
  });

  describe("registerSpecSchemaDocumentationProvider", () => {
    it("invokes providers on every describe, reflecting current state", () => {
      const registry = createEntityKindRegistry();

      registry.registerKind({
        apiVersion: CHECKSTACK_API_VERSION,
        kind: "Automation",
        specSchema: z.object({ actions: z.array(z.unknown()) }),
        reconcile: async () => ({ entityId: "test-id" }),
      });

      // A mutable source the provider reads — modelling a registry that is
      // populated AFTER the provider is registered.
      const source: Array<{ id: string }> = [];
      registry.registerSpecSchemaDocumentationProvider(() =>
        source.map((s) => ({
          apiVersion: CHECKSTACK_API_VERSION,
          kind: "Automation",
          fieldPath: "actions[].config",
          variantId: s.id,
          label: s.id,
          schema: z.object({}),
        })),
      );

      // Empty at first describe.
      expect(
        registry.describeKinds()[0].specSchemaDocumentation,
      ).toHaveLength(0);

      // Source populated later (e.g. another plugin's afterPluginsReady).
      source.push({ id: "jira" }, { id: "teams" });

      const docs = registry.describeKinds()[0].specSchemaDocumentation;
      expect(docs).toHaveLength(2);
      expect(docs.map((d) => d.variantId).sort()).toEqual(["jira", "teams"]);
      expect(docs[0].fieldPath).toBe("actions[].config");
    });

    it("merges provider docs with eagerly registered docs for the same kind", () => {
      const registry = createEntityKindRegistry();

      registry.registerKind({
        apiVersion: CHECKSTACK_API_VERSION,
        kind: "Automation",
        specSchema: z.object({
          triggers: z.array(z.unknown()),
          actions: z.array(z.unknown()),
        }),
        reconcile: async () => ({ entityId: "test-id" }),
      });

      registry.registerSpecSchemaDocumentation({
        apiVersion: CHECKSTACK_API_VERSION,
        kind: "Automation",
        fieldPath: "triggers[].config",
        variantId: "eager",
        label: "Eager",
        schema: z.object({}),
      });

      registry.registerSpecSchemaDocumentationProvider(() => [
        {
          apiVersion: CHECKSTACK_API_VERSION,
          kind: "Automation",
          fieldPath: "actions[].config",
          variantId: "lazy",
          label: "Lazy",
          schema: z.object({}),
        },
      ]);

      const docs = registry.describeKinds()[0].specSchemaDocumentation;
      expect(docs.map((d) => d.variantId).sort()).toEqual(["eager", "lazy"]);
    });

    it("ignores provider docs whose kind has no base definition", () => {
      const registry = createEntityKindRegistry();

      registry.registerSpecSchemaDocumentationProvider(() => [
        {
          apiVersion: CHECKSTACK_API_VERSION,
          kind: "Unregistered",
          fieldPath: "config",
          label: "X",
          schema: z.object({}),
        },
      ]);

      // No base definition for "Unregistered" → not described.
      expect(registry.describeKinds()).toHaveLength(0);
    });
  });
});
