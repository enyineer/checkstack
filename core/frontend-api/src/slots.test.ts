import { describe, expect, test, beforeEach } from "bun:test";
import { createSlot, SlotDefinition } from "./slots";
import { pluginRegistry } from "./plugin-registry";
import { createFrontendPlugin } from "./plugin";

describe("createSlot", () => {
  test("creates a slot definition with the correct id", () => {
    const slot = createSlot("test.slot.id");
    expect(slot.id).toBe("test.slot.id");
  });

  test("creates a slot definition with typed context", () => {
    interface MyContext {
      userId: string;
      label: string;
    }

    const slot = createSlot<MyContext>("typed.slot");
    expect(slot.id).toBe("typed.slot");

    // Type check: slot._contextType should be assignable to MyContext
    // This is a compile-time check, at runtime _contextType is undefined
    const contextType: MyContext | undefined = slot._contextType;
    expect(contextType).toBeUndefined();
  });

  test("creates slot with undefined context type by default", () => {
    const slot = createSlot("simple.slot");
    expect(slot.id).toBe("simple.slot");
    expect(slot._contextType).toBeUndefined();
  });
});

describe("Cross-Plugin Slot Usage", () => {
  // Simulate: PluginA exposes a slot from its common package
  const PluginASlot = createSlot<{ message: string }>("plugin-a.custom.slot");

  // Simulate: PluginB creates an extension for PluginA's slot
  const MockComponent = () => null;

  beforeEach(() => {
    pluginRegistry.reset();
  });

  test("PluginB can register an extension to PluginA's exported slot", () => {
    // PluginA would typically define its slot in its -common package
    // e.g., export const PluginASlot = createSlot<...>("plugin-a.custom.slot")

    // PluginB imports and uses the slot:
    const pluginB = createFrontendPlugin({
      name: "plugin-b-frontend",
      extensions: [
        {
          id: "plugin-b.extension-for-plugin-a",
          slot: PluginASlot, // Using the SlotDefinition directly
          component: MockComponent,
        },
      ],
    });

    pluginRegistry.register(pluginB);

    // Verify the extension is registered to the correct slot
    const extensions = pluginRegistry.getExtensions(PluginASlot.id);
    expect(extensions).toHaveLength(1);
    expect(extensions[0].id).toBe("plugin-b.extension-for-plugin-a");
    expect(extensions[0].component).toBe(MockComponent);
  });

  test("multiple plugins can register extensions to the same slot", () => {
    const MockComponentB = () => null;
    const MockComponentC = () => null;

    const pluginB = createFrontendPlugin({
      name: "plugin-b-frontend",
      extensions: [
        {
          id: "plugin-b.extension",
          slot: PluginASlot,
          component: MockComponentB,
        },
      ],
    });

    const pluginC = createFrontendPlugin({
      name: "plugin-c-frontend",
      extensions: [
        {
          id: "plugin-c.extension",
          slot: PluginASlot,
          component: MockComponentC,
        },
      ],
    });

    pluginRegistry.register(pluginB);
    pluginRegistry.register(pluginC);

    const extensions = pluginRegistry.getExtensions(PluginASlot.id);
    expect(extensions).toHaveLength(2);
    expect(extensions.map((e) => e.id)).toContain("plugin-b.extension");
    expect(extensions.map((e) => e.id)).toContain("plugin-c.extension");
  });

  test("extensions are removed when plugin is unregistered", () => {
    const pluginB = createFrontendPlugin({
      name: "plugin-b-frontend",
      extensions: [
        {
          id: "plugin-b.extension",
          slot: PluginASlot,
          component: MockComponent,
        },
      ],
    });

    pluginRegistry.register(pluginB);
    expect(pluginRegistry.getExtensions(PluginASlot.id)).toHaveLength(1);

    pluginRegistry.unregister("plugin-b-frontend");
    expect(pluginRegistry.getExtensions(PluginASlot.id)).toHaveLength(0);
  });

  test("slot id property is readonly and consistent", () => {
    const slot1 = createSlot("consistent.slot");
    const slot2 = createSlot("consistent.slot");

    // Same id string creates equivalent slot references
    expect(slot1.id).toBe(slot2.id);

    // Extensions registered to either slot.id will be in the same collection
    const pluginB = createFrontendPlugin({
      name: "plugin-b-frontend",
      extensions: [
        {
          id: "plugin-b.ext1",
          slot: slot1,
          component: MockComponent,
        },
      ],
    });

    const pluginC = createFrontendPlugin({
      name: "plugin-c-frontend",
      extensions: [
        {
          id: "plugin-c.ext2",
          slot: slot2,
          component: MockComponent,
        },
      ],
    });

    pluginRegistry.register(pluginB);
    pluginRegistry.register(pluginC);

    // Both extensions should be in the same slot
    expect(pluginRegistry.getExtensions(slot1.id)).toHaveLength(2);
    expect(pluginRegistry.getExtensions(slot2.id)).toHaveLength(2);
  });
});

describe("SlotDefinition type safety", () => {
  test("slot context type is preserved as phantom type", () => {
    interface SystemContext {
      systemId: string;
      systemName: string;
    }

    const slot: SlotDefinition<SystemContext> =
      createSlot<SystemContext>("system.details");

    // The id is accessible
    expect(slot.id).toBe("system.details");

    // Type assertion to verify the phantom type is correct
    // This is a compile-time check - the actual value is undefined
    type ExtractedContext = NonNullable<typeof slot._contextType>;
    const _typeCheck: ExtractedContext = { systemId: "1", systemName: "Test" };
    expect(_typeCheck).toBeDefined();
  });

  test("createSlot with object context type", () => {
    const slot = createSlot<{ count: number; items: string[] }>("complex.slot");
    expect(slot.id).toBe("complex.slot");
  });

  test("createSlot without context type defaults to undefined", () => {
    const slot = createSlot("no-context.slot");

    // Type should be SlotDefinition<undefined>
    // When NonNullable is applied to undefined, it becomes never
    // This is just a compile-time type verification
    expect(slot.id).toBe("no-context.slot");
  });
});
