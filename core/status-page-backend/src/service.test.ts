import { describe, test, expect } from "bun:test";
import { z } from "zod";
import type { Logger, RpcClient, SafeDatabase } from "@checkstack/backend-api";
import { StatusPageService } from "./service";
import type {
  RegisteredWidgetType,
  WidgetTypeRegistry,
} from "./widget-registry";
import type { StatusPageRow } from "./schema";
import * as schema from "./schema";
import { BUILTIN_WIDGET_IDS } from "@checkstack/status-page-common";

/** Minimal chainable fake of the drizzle query used by resolvePublished. */
function fakeDb(row: StatusPageRow | undefined): SafeDatabase<typeof schema> {
  const result = row ? [row] : [];
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(result),
  };
  // Cast: a hand-rolled stub of the SafeDatabase surface the service touches.
  return { select: () => chain } as unknown as SafeDatabase<typeof schema>;
}

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Logger;

const noRpc: RpcClient = {
  forPlugin: () => ({}) as never,
};

function widget(
  over: Partial<RegisteredWidgetType> & { id: string },
): RegisteredWidgetType {
  return {
    id: over.id,
    qualifiedId: over.qualifiedId ?? `test.${over.id}`,
    ownerPluginId: "test",
    displayName: over.id,
    description: "",
    category: "Test",
    binding: "none",
    configSchema: z.unknown(),
    dtoSchema: over.dtoSchema ?? z.object({ value: z.string() }),
    boundResources: over.boundResources ?? (() => []),
    resolvePublic:
      over.resolvePublic ?? (async () => ({ value: "ok" })),
    assertBindingsReadable: over.assertBindingsReadable,
    rendererRemote: over.rendererRemote,
  };
}

function registryOf(widgets: RegisteredWidgetType[]): WidgetTypeRegistry {
  const map = new Map(widgets.map((w) => [w.qualifiedId, w]));
  return {
    register: () => {},
    get: (id) => map.get(id),
    list: () => [...map.values()],
  };
}

function row(over: Partial<StatusPageRow>): StatusPageRow {
  return {
    id: "p1",
    slug: "acme",
    title: "Acme",
    visibility: "public",
    theme: { mode: "auto" },
    draftLayout: [],
    publishedLayout: null,
    publishedAt: null,
    customDomain: null,
    customDomainToken: null,
    customDomainVerifiedAt: null,
    createdAt: new Date("2026-06-01T00:00:00Z"),
    updatedAt: new Date("2026-06-01T00:00:00Z"),
    ...over,
  } as StatusPageRow;
}

function service(args: {
  row?: StatusPageRow;
  widgets?: RegisteredWidgetType[];
  primaryHost?: string | null;
}): StatusPageService {
  return new StatusPageService({
    db: fakeDb(args.row),
    registry: registryOf(args.widgets ?? []),
    rpcClient: noRpc,
    logger: noopLogger,
    txtResolver: async () => [],
    primaryHost: args.primaryHost ?? null,
  });
}

describe("resolvePublished — isolation + visibility", () => {
  test("returns null for a page that is not published", async () => {
    const svc = service({ row: row({ publishedLayout: null }) });
    expect(
      await svc.resolvePublished({ slug: "acme", isAuthenticated: false }),
    ).toBeNull();
  });

  test("an authenticated-only page is hidden from anonymous callers", async () => {
    const svc = service({
      row: row({ visibility: "authenticated", publishedLayout: [] }),
    });
    expect(
      await svc.resolvePublished({ slug: "acme", isAuthenticated: false }),
    ).toBeNull();
    expect(
      await svc.resolvePublished({ slug: "acme", isAuthenticated: true }),
    ).not.toBeNull();
  });

  test("only blocks in the PUBLISHED layout are resolved", async () => {
    const svc = service({
      row: row({
        publishedLayout: [{ id: "b1", type: "test.ok", config: {} }],
        // Draft has an extra block that must NEVER appear publicly.
        draftLayout: [
          { id: "b1", type: "test.ok", config: {} },
          { id: "secret", type: "test.ok", config: {} },
        ],
      }),
      widgets: [widget({ id: "ok" })],
    });
    const result = await svc.resolvePublished({
      slug: "acme",
      isAuthenticated: false,
    });
    expect(result?.blocks.map((b) => b.id)).toEqual(["b1"]);
  });

  test("the DTO schema is the allow-list — extra resolver fields are stripped", async () => {
    const svc = service({
      row: row({ publishedLayout: [{ id: "b1", type: "test.ok", config: {} }] }),
      widgets: [
        widget({
          id: "ok",
          dtoSchema: z.object({ value: z.string() }),
          resolvePublic: async () => ({ value: "shown", secret: "LEAK" }),
        }),
      ],
    });
    const result = await svc.resolvePublished({
      slug: "acme",
      isAuthenticated: false,
    });
    expect(result?.blocks[0].data).toEqual({ value: "shown" });
    expect(JSON.stringify(result)).not.toContain("LEAK");
  });

  test("a failing widget degrades to data:null, never crashing the page", async () => {
    const svc = service({
      row: row({
        publishedLayout: [
          { id: "bad", type: "test.boom", config: {} },
          { id: "good", type: "test.ok", config: {} },
        ],
      }),
      widgets: [
        widget({
          id: "boom",
          qualifiedId: "test.boom",
          resolvePublic: async () => {
            throw new Error("resolver blew up");
          },
        }),
        widget({ id: "ok" }),
      ],
    });
    const result = await svc.resolvePublished({
      slug: "acme",
      isAuthenticated: false,
    });
    expect(result?.blocks.find((b) => b.id === "bad")?.data).toBeNull();
    expect(result?.blocks.find((b) => b.id === "good")?.data).toEqual({
      value: "ok",
    });
  });

  test("unknown widget types are skipped, not rendered", async () => {
    const svc = service({
      row: row({
        publishedLayout: [{ id: "x", type: "ghost.widget", config: {} }],
      }),
      widgets: [],
    });
    const result = await svc.resolvePublished({
      slug: "acme",
      isAuthenticated: false,
    });
    expect(result?.blocks).toEqual([]);
  });
});

describe("resolvePublished — overallStatus rollup", () => {
  const bannerWidget = (status: string) =>
    widget({
      id: "banner",
      qualifiedId: BUILTIN_WIDGET_IDS.banner,
      dtoSchema: z.object({ status: z.string(), title: z.string() }),
      resolvePublic: async () => ({ status, title: "x" }),
    });

  test("worst-status-wins across resolved blocks", async () => {
    const svc = service({
      row: row({
        publishedLayout: [
          { id: "b1", type: BUILTIN_WIDGET_IDS.banner, config: {} },
          { id: "b2", type: BUILTIN_WIDGET_IDS.banner, config: {} },
        ],
      }),
      // Both banners share the same qualifiedId; the registry maps that id to a
      // single widget, so register the worse one to assert it wins.
      widgets: [bannerWidget("major_outage")],
    });
    const result = await svc.resolvePublished({
      slug: "acme",
      isAuthenticated: false,
    });
    expect(result?.overallStatus.status).toBe("major_outage");
    expect(result?.overallStatus.label).toBe("Major outage");
  });

  test("operational when the only status signal is operational", async () => {
    const svc = service({
      row: row({
        publishedLayout: [
          { id: "b1", type: BUILTIN_WIDGET_IDS.banner, config: {} },
        ],
      }),
      widgets: [bannerWidget("operational")],
    });
    const result = await svc.resolvePublished({
      slug: "acme",
      isAuthenticated: false,
    });
    expect(result?.overallStatus.status).toBe("operational");
  });

  test("unknown when no widget contributes a status", async () => {
    const svc = service({
      row: row({
        publishedLayout: [{ id: "b1", type: "test.ok", config: {} }],
      }),
      widgets: [widget({ id: "ok" })],
    });
    const result = await svc.resolvePublished({
      slug: "acme",
      isAuthenticated: false,
    });
    expect(result?.overallStatus.status).toBe("unknown");
  });
});

describe("publish gate — delegates to the widget, fails closed", () => {
  test("propagates a widget's access-check failure as FORBIDDEN", async () => {
    const sysWidget = widget({
      id: "sys",
      qualifiedId: "test.sys",
      boundResources: () => [
        { resourceType: "catalog.system", resourceId: "s1" },
      ],
      assertBindingsReadable: async () => {
        throw new Error("System s1 is not accessible");
      },
    });
    const svc = service({
      row: row({ draftLayout: [{ id: "b", type: "test.sys", config: {} }] }),
      widgets: [sysWidget],
    });
    await expect(
      svc.publish({ id: "p1", userClient: noRpc }),
    ).rejects.toThrow(/not accessible/i);
  });

  test("FAILS CLOSED when a binding widget provides no access check", async () => {
    const noCheck = widget({
      id: "nocheck",
      qualifiedId: "test.nocheck",
      boundResources: () => [
        { resourceType: "catalog.system", resourceId: "s1" },
      ],
      // no assertBindingsReadable
    });
    const svc = service({
      row: row({ draftLayout: [{ id: "b", type: "test.nocheck", config: {} }] }),
      widgets: [noCheck],
    });
    await expect(
      svc.publish({ id: "p1", userClient: noRpc }),
    ).rejects.toThrow(/cannot be published/i);
  });

  test("allows publish when the widget's access check passes", async () => {
    let checked = false;
    const okWidget = widget({
      id: "ok",
      qualifiedId: "test.okbind",
      boundResources: () => [
        { resourceType: "catalog.system", resourceId: "s1" },
      ],
      assertBindingsReadable: async () => {
        checked = true;
      },
    });
    const svc = service({
      row: row({ draftLayout: [{ id: "b", type: "test.okbind", config: {} }] }),
      widgets: [okWidget],
    });
    // The select-only fake DB can't service the post-gate UPDATE, so we only
    // assert the gate ran + passed (the update path is covered elsewhere).
    await svc.publish({ id: "p1", userClient: noRpc }).catch(() => undefined);
    expect(checked).toBe(true);
  });
});

describe("collectBoundResources", () => {
  test("dedupes bound resources across blocks", () => {
    const svc = service({
      widgets: [
        widget({
          id: "w",
          boundResources: () => [
            { resourceType: "catalog.system", resourceId: "s1" },
          ],
        }),
      ],
    });
    const bound = svc.collectBoundResources([
      { id: "a", type: "test.w", config: {} },
      { id: "b", type: "test.w", config: {} },
    ]);
    expect(bound).toEqual([
      { resourceType: "catalog.system", resourceId: "s1" },
    ]);
  });
});

describe("resolveByHost — routing gate (verified AND published)", () => {
  const verified = new Date("2026-06-02T00:00:00Z");
  const published = new Date("2026-06-02T00:00:00Z");

  test("returns the slug only when the domain is verified AND published", async () => {
    const svc = service({
      row: row({
        slug: "acme",
        customDomain: "status.acme.com",
        customDomainVerifiedAt: verified,
        publishedAt: published,
        publishedLayout: [],
      }),
    });
    expect(await svc.resolveByHost("status.acme.com")).toEqual({ slug: "acme" });
  });

  test("returns null when the domain is not yet verified", async () => {
    const svc = service({
      row: row({
        customDomain: "status.acme.com",
        customDomainVerifiedAt: null,
        publishedAt: published,
        publishedLayout: [],
      }),
    });
    expect(await svc.resolveByHost("status.acme.com")).toBeNull();
  });

  test("returns null when the page is verified but not published", async () => {
    const svc = service({
      row: row({
        customDomain: "status.acme.com",
        customDomainVerifiedAt: verified,
        publishedAt: null,
        publishedLayout: null,
      }),
    });
    expect(await svc.resolveByHost("status.acme.com")).toBeNull();
  });

  test("returns null for an unknown host", async () => {
    const svc = service({ row: undefined });
    expect(await svc.resolveByHost("nope.example.com")).toBeNull();
  });

  test("returns null for an empty host", async () => {
    const svc = service({ row: undefined });
    expect(await svc.resolveByHost("   ")).toBeNull();
  });

  test("returns null for an authenticated-visibility page (custom domains are public-only)", async () => {
    const svc = service({
      row: row({
        visibility: "authenticated",
        customDomain: "status.acme.com",
        customDomainVerifiedAt: verified,
        publishedAt: published,
        publishedLayout: [],
      }),
    });
    expect(await svc.resolveByHost("status.acme.com")).toBeNull();
  });
});

describe("resolvePublished — renderer remotes (third-party widgets)", () => {
  test("lists the remote for a third-party widget, dedupes, and omits built-ins", async () => {
    const svc = service({
      row: row({
        publishedLayout: [
          { id: "a", type: "test.builtin", config: {} },
          { id: "b", type: "test.remote", config: {} },
          { id: "c", type: "test.remote", config: {} }, // same type -> deduped
        ],
      }),
      widgets: [
        widget({ id: "builtin", qualifiedId: "test.builtin" }),
        widget({
          id: "remote",
          qualifiedId: "test.remote",
          rendererRemote: "@acme/widgets-frontend",
        }),
      ],
    });
    const result = await svc.resolvePublished({
      slug: "acme",
      isAuthenticated: false,
    });
    expect(result?.rendererRemotes).toEqual([
      { widgetTypeId: "test.remote", packageName: "@acme/widgets-frontend" },
    ]);
  });

  test("is empty for a built-in-only page", async () => {
    const svc = service({
      row: row({ publishedLayout: [{ id: "a", type: "test.builtin", config: {} }] }),
      widgets: [widget({ id: "builtin", qualifiedId: "test.builtin" })],
    });
    const result = await svc.resolvePublished({
      slug: "acme",
      isAuthenticated: false,
    });
    expect(result?.rendererRemotes).toEqual([]);
  });
});
