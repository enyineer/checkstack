import { describe, test, expect } from "bun:test";
import { z } from "zod";
import type { PluginMetadata } from "@checkstack/common";
import {
  createWidgetTypeRegistry,
  type WidgetTypeDefinition,
} from "./widget-registry";

function meta(pluginId: string): PluginMetadata {
  return { pluginId } as unknown as PluginMetadata;
}

function def(
  over: Partial<WidgetTypeDefinition> & { id: string },
): WidgetTypeDefinition {
  return {
    id: over.id,
    displayName: over.displayName ?? over.id,
    description: over.description ?? "",
    category: over.category ?? "Content",
    binding: over.binding ?? "none",
    rendererRemote: over.rendererRemote,
    configSchema: over.configSchema ?? z.object({}),
    dtoSchema: over.dtoSchema ?? z.object({}),
    boundResources: over.boundResources ?? (() => []),
    resolvePublic: over.resolvePublic ?? (async () => ({})),
    assertBindingsReadable: over.assertBindingsReadable,
  };
}

describe("createWidgetTypeRegistry", () => {
  test("qualifies the widget id with the registering plugin id", () => {
    const registry = createWidgetTypeRegistry();
    registry.register(def({ id: "banner" }), meta("statuspage"));

    const got = registry.get("statuspage.banner");
    expect(got?.qualifiedId).toBe("statuspage.banner");
    expect(got?.ownerPluginId).toBe("statuspage");
    expect(got?.id).toBe("banner");
  });

  test("get returns undefined for an unregistered qualified id", () => {
    const registry = createWidgetTypeRegistry();
    expect(registry.get("statuspage.ghost")).toBeUndefined();
  });

  test("list returns every registered widget across plugins", () => {
    const registry = createWidgetTypeRegistry();
    registry.register(def({ id: "text" }), meta("statuspage"));
    registry.register(def({ id: "uptime" }), meta("healthcheck"));

    const ids = registry.list().map((w) => w.qualifiedId).toSorted();
    expect(ids).toEqual(["healthcheck.uptime", "statuspage.text"]);
  });

  test("two plugins can register the same local id without colliding", () => {
    const registry = createWidgetTypeRegistry();
    registry.register(def({ id: "status" }), meta("a"));
    registry.register(def({ id: "status" }), meta("b"));

    expect(registry.get("a.status")?.ownerPluginId).toBe("a");
    expect(registry.get("b.status")?.ownerPluginId).toBe("b");
    expect(registry.list()).toHaveLength(2);
  });

  test("re-registering the same qualified id overwrites the prior definition", () => {
    const registry = createWidgetTypeRegistry();
    registry.register(def({ id: "text", displayName: "Old" }), meta("statuspage"));
    registry.register(def({ id: "text", displayName: "New" }), meta("statuspage"));

    expect(registry.get("statuspage.text")?.displayName).toBe("New");
    expect(registry.list()).toHaveLength(1);
  });

  test("preserves the definition's own fields when qualifying", () => {
    const registry = createWidgetTypeRegistry();
    registry.register(
      def({
        id: "remote",
        category: "Custom",
        binding: "system",
        rendererRemote: "@acme/widgets-frontend",
      }),
      meta("acme"),
    );

    const got = registry.get("acme.remote");
    expect(got?.category).toBe("Custom");
    expect(got?.binding).toBe("system");
    expect(got?.rendererRemote).toBe("@acme/widgets-frontend");
  });
});
