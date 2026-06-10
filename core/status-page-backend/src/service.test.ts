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
    createdAt: new Date("2026-06-01T00:00:00Z"),
    updatedAt: new Date("2026-06-01T00:00:00Z"),
    ...over,
  } as StatusPageRow;
}

function service(args: {
  row?: StatusPageRow;
  widgets?: RegisteredWidgetType[];
}): StatusPageService {
  return new StatusPageService({
    db: fakeDb(args.row),
    registry: registryOf(args.widgets ?? []),
    rpcClient: noRpc,
    logger: noopLogger,
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

/** A user-scoped client that denies access to every system/group. */
const denyingUserClient: RpcClient = {
  forPlugin: () =>
    ({
      getSystem: async () => null,
      getGroups: async () => [],
    }) as never,
};

describe("publish gate — cannot publish what you cannot see", () => {
  test("refuses when a bound system is not accessible to the editor", async () => {
    const sysWidget = widget({
      id: "sys",
      qualifiedId: "test.sys",
      boundResources: () => [
        { resourceType: "catalog.system", resourceId: "s1" },
      ],
    });
    const svc = service({
      row: row({ draftLayout: [{ id: "b", type: "test.sys", config: {} }] }),
      widgets: [sysWidget],
    });
    await expect(
      svc.publish({ id: "p1", userClient: denyingUserClient }),
    ).rejects.toThrow(/access/i);
  });

  test("FAILS CLOSED on a bound resource type it cannot verify", async () => {
    const otherWidget = widget({
      id: "other",
      qualifiedId: "test.other",
      boundResources: () => [
        { resourceType: "other.thing", resourceId: "x" },
      ],
    });
    const svc = service({
      row: row({ draftLayout: [{ id: "b", type: "test.other", config: {} }] }),
      widgets: [otherWidget],
    });
    await expect(
      svc.publish({ id: "p1", userClient: denyingUserClient }),
    ).rejects.toThrow(/verify publish access/i);
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
