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
    resolveDetail: over.resolveDetail,
    mentionType: over.mentionType,
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

describe("resolvePublished — environment scope threading", () => {
  function capturingWidget(sink: { seen?: string[]; called: boolean }) {
    return widget({
      id: "cap",
      qualifiedId: "test.cap",
      resolvePublic: async ({ ctx }) => {
        sink.called = true;
        sink.seen = ctx.publishedEnvironmentIds;
        return { value: "ok" };
      },
    });
  }

  test("threads the page's published environment ids into the widget ctx", async () => {
    const sink = { called: false } as { seen?: string[]; called: boolean };
    const svc = service({
      row: row({
        publishedEnvironmentIds: ["prod", "stage"],
        publishedLayout: [{ id: "b1", type: "test.cap", config: {} }],
      }),
      widgets: [capturingWidget(sink)],
    });
    await svc.resolvePublished({ slug: "acme", isAuthenticated: false });
    expect(sink.called).toBe(true);
    expect(sink.seen).toEqual(["prod", "stage"]);
  });

  test("a NULL env column threads undefined (all environments)", async () => {
    const sink = { called: false } as { seen?: string[]; called: boolean };
    const svc = service({
      row: row({
        publishedEnvironmentIds: null,
        publishedLayout: [{ id: "b1", type: "test.cap", config: {} }],
      }),
      widgets: [capturingWidget(sink)],
    });
    await svc.resolvePublished({ slug: "acme", isAuthenticated: false });
    expect(sink.called).toBe(true);
    expect(sink.seen).toBeUndefined();
  });

  test("an EMPTY env array threads undefined (all environments)", async () => {
    const sink = { called: false } as { seen?: string[]; called: boolean };
    const svc = service({
      row: row({
        publishedEnvironmentIds: [],
        publishedLayout: [{ id: "b1", type: "test.cap", config: {} }],
      }),
      widgets: [capturingWidget(sink)],
    });
    await svc.resolvePublished({ slug: "acme", isAuthenticated: false });
    expect(sink.seen).toBeUndefined();
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

// ---------------------------------------------------------------------------
// resolvePublishedIncident / resolvePublishedMaintenance — the per-item detail
// endpoints. They must delegate to the widget's `resolveDetail` (full item:
// ALL updates + description, Items 5/6), gate on the published layout (the same
// anti-enumeration boundary as the block), validate against the item schema
// (allow-list), and fail closed on a resolver error — WITHOUT crashing.
// ---------------------------------------------------------------------------

const incidentItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  severity: z.string(),
  systems: z.array(z.string()),
  startedAt: z.string(),
  description: z.string().optional(),
  updates: z.array(
    z.object({ message: z.string(), at: z.string() }),
  ),
});

/** A published page carrying ONE incidents block backed by `resolveDetail`. */
function incidentDetailService(
  resolveDetail: RegisteredWidgetType["resolveDetail"],
): StatusPageService {
  return service({
    row: row({
      publishedLayout: [
        { id: "inc-block", type: BUILTIN_WIDGET_IDS.incidents, config: {} },
      ],
    }),
    widgets: [
      widget({
        id: "incidents",
        qualifiedId: BUILTIN_WIDGET_IDS.incidents,
        dtoSchema: z.object({ incidents: z.array(incidentItemSchema) }),
        resolveDetail,
      }),
    ],
  });
}

describe("resolvePublishedIncident — delegates to resolveDetail + gates", () => {
  test("returns the FULL item (all updates + description) the widget resolves", async () => {
    const svc = incidentDetailService(async ({ id }) =>
      id === "inc-1"
        ? {
            id: "inc-1",
            title: "API outage",
            status: "monitoring",
            severity: "major",
            systems: ["System One"],
            startedAt: "2026-07-01T00:00:00Z",
            description: "Postmortem",
            // MORE updates than any block cap would allow — proves the detail
            // path is not the capped block DTO.
            updates: [
              { message: "u1", at: "2026-07-01T01:00:00Z" },
              { message: "u2", at: "2026-07-01T02:00:00Z" },
              { message: "u3", at: "2026-07-01T03:00:00Z" },
              { message: "u4", at: "2026-07-01T04:00:00Z" },
            ],
          }
        : null,
    );
    const item = await svc.resolvePublishedIncident({
      slug: "acme",
      id: "inc-1",
      isAuthenticated: false,
    });
    expect(item?.updates).toHaveLength(4);
    expect(item?.description).toBe("Postmortem");
  });

  test("returns null when the widget does not surface the id (gate)", async () => {
    const svc = incidentDetailService(async () => null);
    expect(
      await svc.resolvePublishedIncident({
        slug: "acme",
        id: "unknown",
        isAuthenticated: false,
      }),
    ).toBeNull();
  });

  test("a resolveDetail throw degrades to null, never crashing", async () => {
    const svc = incidentDetailService(async () => {
      throw new Error("resolver blew up");
    });
    expect(
      await svc.resolvePublishedIncident({
        slug: "acme",
        id: "inc-1",
        isAuthenticated: false,
      }),
    ).toBeNull();
  });

  test("the item schema is the allow-list — extra resolver fields are stripped", async () => {
    const svc = incidentDetailService(async () => ({
      id: "inc-1",
      title: "API outage",
      status: "monitoring",
      severity: "major",
      systems: ["System One"],
      startedAt: "2026-07-01T00:00:00Z",
      updates: [],
      // A field the item schema does not allow-list — must be stripped.
      createdBy: "LEAK-user-id",
    }));
    const item = await svc.resolvePublishedIncident({
      slug: "acme",
      id: "inc-1",
      isAuthenticated: false,
    });
    expect(JSON.stringify(item)).not.toContain("LEAK");
  });

  test("an unpublished page yields null even for a real id (no leak)", async () => {
    const svc = service({
      row: row({ publishedLayout: null }),
      widgets: [
        widget({
          id: "incidents",
          qualifiedId: BUILTIN_WIDGET_IDS.incidents,
          resolveDetail: async () => ({ id: "inc-1" }),
        }),
      ],
    });
    expect(
      await svc.resolvePublishedIncident({
        slug: "acme",
        id: "inc-1",
        isAuthenticated: false,
      }),
    ).toBeNull();
  });
});

/**
 * `resolvePublicMentions` decides whether a `#` reference written in an update
 * becomes a link on a PUBLIC page. The gate must be exactly the detail page's:
 * a reference resolves only when this page surfaces the target. Anything looser
 * would let a public update confirm the existence of an internal-only incident.
 */
describe("resolvePublicMentions — the public page gates its own references", () => {
  const pageWith = (widgets: RegisteredWidgetType[], layoutTypes: string[]) =>
    service({
      row: row({
        publishedLayout: layoutTypes.map((type, i) => ({
          id: `b${i}`,
          type,
          config: {},
        })),
      }),
      widgets,
    });

  const eventWidget = (args: {
    id: string;
    mentionType?: string;
    surfaces: string[];
  }) =>
    widget({
      id: args.id,
      qualifiedId: `statuspage.${args.id}`,
      ...(args.mentionType ? { mentionType: args.mentionType } : {}),
      resolveDetail: async ({ id }) =>
        args.surfaces.includes(id) ? { value: id } : null,
    });

  test("resolves a reference the page surfaces", async () => {
    const svc = pageWith(
      [
        eventWidget({
          id: "maintenance",
          mentionType: "maintenance",
          surfaces: ["m1"],
        }),
      ],
      ["statuspage.maintenance"],
    );

    expect(
      await svc.resolvePublicMentions({
        slug: "acme",
        refs: [{ type: "maintenance", id: "m1" }],
        isAuthenticated: false,
      }),
    ).toEqual([{ type: "maintenance", id: "m1" }]);
  });

  test("does NOT resolve a reference the page does not surface", async () => {
    const svc = pageWith(
      [
        eventWidget({
          id: "incidents",
          mentionType: "incident",
          surfaces: ["public-one"],
        }),
      ],
      ["statuspage.incidents"],
    );

    expect(
      await svc.resolvePublicMentions({
        slug: "acme",
        refs: [{ type: "incident", id: "internal-only" }],
        isAuthenticated: false,
      }),
    ).toEqual([]);
  });

  test("routes each ref to the widget that DECLARES its mention type", async () => {
    const svc = pageWith(
      [
        eventWidget({
          id: "incidents",
          mentionType: "incident",
          surfaces: ["shared-id"],
        }),
        eventWidget({
          id: "maintenance",
          mentionType: "maintenance",
          surfaces: [],
        }),
      ],
      ["statuspage.incidents", "statuspage.maintenance"],
    );

    // The same id under the maintenance type must NOT be satisfied by the
    // incidents widget that happens to surface that id.
    expect(
      await svc.resolvePublicMentions({
        slug: "acme",
        refs: [
          { type: "incident", id: "shared-id" },
          { type: "maintenance", id: "shared-id" },
        ],
        isAuthenticated: false,
      }),
    ).toEqual([{ type: "incident", id: "shared-id" }]);
  });

  test("ignores a widget that declares NO mention type", async () => {
    // Opting in is explicit; a widget with a detail page but no declared type
    // must not start resolving references.
    const svc = pageWith(
      [eventWidget({ id: "incidents", surfaces: ["i1"] })],
      ["statuspage.incidents"],
    );

    expect(
      await svc.resolvePublicMentions({
        slug: "acme",
        refs: [{ type: "incident", id: "i1" }],
        isAuthenticated: false,
      }),
    ).toEqual([]);
  });

  test("resolves nothing for an UNPUBLISHED page", async () => {
    const svc = service({
      row: row({ publishedLayout: null }),
      widgets: [
        eventWidget({
          id: "incidents",
          mentionType: "incident",
          surfaces: ["i1"],
        }),
      ],
    });

    expect(
      await svc.resolvePublicMentions({
        slug: "acme",
        refs: [{ type: "incident", id: "i1" }],
        isAuthenticated: false,
      }),
    ).toEqual([]);
  });

  test("resolves nothing for a page that does not exist", async () => {
    const svc = service({ widgets: [] });

    expect(
      await svc.resolvePublicMentions({
        slug: "nope",
        refs: [{ type: "incident", id: "i1" }],
        isAuthenticated: false,
      }),
    ).toEqual([]);
  });

  test("an authenticated-only page resolves nothing for an anonymous visitor", async () => {
    // Mirrors the page read itself: visibility is enforced before any ref is
    // considered, so mentions cannot become an oracle for a gated page.
    const svc = service({
      row: row({
        visibility: "authenticated",
        publishedLayout: [
          { id: "b0", type: "statuspage.incidents", config: {} },
        ],
      }),
      widgets: [
        eventWidget({
          id: "incidents",
          mentionType: "incident",
          surfaces: ["i1"],
        }),
      ],
    });

    expect(
      await svc.resolvePublicMentions({
        slug: "acme",
        refs: [{ type: "incident", id: "i1" }],
        isAuthenticated: false,
      }),
    ).toEqual([]);
    // ...and does resolve once authenticated.
    expect(
      await svc.resolvePublicMentions({
        slug: "acme",
        refs: [{ type: "incident", id: "i1" }],
        isAuthenticated: true,
      }),
    ).toEqual([{ type: "incident", id: "i1" }]);
  });

  test("a resolveDetail throw makes that ref unlinkable, never linkable", async () => {
    const svc = pageWith(
      [
        widget({
          id: "incidents",
          qualifiedId: "statuspage.incidents",
          mentionType: "incident",
          resolveDetail: async () => {
            throw new Error("resolver blew up");
          },
        }),
      ],
      ["statuspage.incidents"],
    );

    expect(
      await svc.resolvePublicMentions({
        slug: "acme",
        refs: [{ type: "incident", id: "i1" }],
        isAuthenticated: false,
      }),
    ).toEqual([]);
  });

  test("de-duplicates repeated refs so each costs one resolve", async () => {
    let calls = 0;
    const svc = pageWith(
      [
        widget({
          id: "incidents",
          qualifiedId: "statuspage.incidents",
          mentionType: "incident",
          resolveDetail: async ({ id }) => {
            calls++;
            return { value: id };
          },
        }),
      ],
      ["statuspage.incidents"],
    );

    const out = await svc.resolvePublicMentions({
      slug: "acme",
      refs: [
        { type: "incident", id: "i1" },
        { type: "incident", id: "i1" },
        { type: "incident", id: "i1" },
      ],
      isAuthenticated: false,
    });

    expect(out).toEqual([{ type: "incident", id: "i1" }]);
    expect(calls).toBe(1);
  });

  test("an empty ref list short-circuits without loading the page", async () => {
    const svc = service({ widgets: [] });

    expect(
      await svc.resolvePublicMentions({
        slug: "acme",
        refs: [],
        isAuthenticated: false,
      }),
    ).toEqual([]);
  });
});
