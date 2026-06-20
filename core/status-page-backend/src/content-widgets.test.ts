import { describe, test, expect } from "bun:test";
import type { RpcClient } from "@checkstack/backend-api";
import { registerContentWidgets } from "./content-widgets";
import {
  createWidgetTypeRegistry,
  type RegisteredWidgetType,
  type WidgetResolveContext,
} from "./widget-registry";

/** Minimal resolve ctx; the content widgets ignore it (config IS the DTO). */
const ctx: WidgetResolveContext = {
  rpcClient: { forPlugin: () => ({}) } as unknown as RpcClient,
  cache: async (_key, loader) => loader(),
};

function registered(): RegisteredWidgetType[] {
  const registry = createWidgetTypeRegistry();
  registerContentWidgets(registry);
  return registry.list();
}

function byId(id: string): RegisteredWidgetType {
  const w = registered().find((x) => x.qualifiedId === id);
  if (!w) throw new Error(`widget ${id} not registered`);
  return w;
}

describe("registerContentWidgets", () => {
  test("registers exactly the five built-in content widgets under the statuspage plugin", () => {
    const ids = registered().map((w) => w.qualifiedId).toSorted();
    expect(ids).toEqual([
      "statuspage.divider",
      "statuspage.heading",
      "statuspage.image",
      "statuspage.links",
      "statuspage.text",
    ]);
  });

  test("every content widget binds NO resources (category Content, binding none)", () => {
    for (const w of registered()) {
      expect(w.category).toBe("Content");
      expect(w.binding).toBe("none");
      expect(w.boundResources({})).toEqual([]);
      // content widgets never gate on bindings.
      expect(w.assertBindingsReadable).toBeUndefined();
    }
  });
});

describe("content widget resolvePublic — config defaults to public DTO", () => {
  test("text applies the markdown default and emits the DTO shape", async () => {
    const out = await byId("statuspage.text").resolvePublic({
      config: {},
      ctx,
    });
    expect(out).toEqual({ markdown: "" });
  });

  test("text passes through provided markdown", async () => {
    const out = await byId("statuspage.text").resolvePublic({
      config: { markdown: "# Hello" },
      ctx,
    });
    expect(out).toEqual({ markdown: "# Hello" });
  });

  test("heading applies level default and emits text+level", async () => {
    const out = await byId("statuspage.heading").resolvePublic({
      config: { text: "Section" },
      ctx,
    });
    expect(out).toEqual({ text: "Section", level: 2 });
  });

  test("divider resolves to an empty DTO", async () => {
    const out = await byId("statuspage.divider").resolvePublic({
      config: {},
      ctx,
    });
    expect(out).toEqual({});
  });

  test("links defaults to an empty list and preserves valid links", async () => {
    const empty = await byId("statuspage.links").resolvePublic({
      config: {},
      ctx,
    });
    expect(empty).toEqual({ links: [] });

    const withLinks = await byId("statuspage.links").resolvePublic({
      config: { links: [{ label: "Docs", url: "https://example.com" }] },
      ctx,
    });
    expect(withLinks).toEqual({
      links: [{ label: "Docs", url: "https://example.com" }],
    });
  });

  test("the DTO schema is the allow-list — unknown config fields are dropped", async () => {
    const out = await byId("statuspage.text").resolvePublic({
      config: { markdown: "ok", secret: "LEAK" },
      ctx,
    });
    expect(out).toEqual({ markdown: "ok" });
    expect(JSON.stringify(out)).not.toContain("LEAK");
  });

  test("an invalid config (wrong type) fails closed by rejecting", async () => {
    await expect(
      byId("statuspage.heading").resolvePublic({
        config: { level: 99 },
        ctx,
      }),
    ).rejects.toThrow();
  });
});
